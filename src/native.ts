import { CASEMAP } from "./casemap.ts";

// The C half of the runtime, compiled by the same clang call as a program's IR. Its entry
// points are named `fsh_rt_*`.

// Every allocation goes through fsh_rt_alloc and fsh_rt_free, which count what is live. With
// FISH_LEAKS=1 in the environment, a program reports at exit what it never freed.
//
// A string is a block: a reference count, its length in bytes, a pointer to its bytes, the
// block it shares them with when it is a slice, its UTF-16 length once known (-1 before), its
// breadcrumbs once built, then any bytes it holds itself. A count below zero marks a literal,
// which lives for the whole program, so retain and release skip it.

// A float is written as JavaScript's `String(x)` writes a number: the fewest digits that read
// back as the same value, in plain notation for exponents from -7 to 20 and in exponent
// notation otherwise. An f32 takes the fewest digits that read back as the same f32.
export const NATIVE = String.raw`
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <unwind.h>
#include <pthread.h>
#include <sched.h>
#include <unistd.h>
#include <time.h>
#include <errno.h>
#include <sys/random.h>
#include <fcntl.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <arpa/inet.h>
#ifdef __APPLE__
#include <sys/event.h>
#else
#include <sys/epoll.h>
#include <sys/eventfd.h>
#endif

// Tasks run on several threads, so everything they share is counted atomically.
static int64_t fsh_live = 0;
// Set when the program ends with tasks still running, whose memory is never freed.
static int32_t fsh_abandoned = 0;

void *fsh_rt_alloc(int64_t size) {
  void *p = malloc(size);
  if (!p) {
    fputs("out of memory\n", stderr);
    exit(101);
  }
  __atomic_fetch_add(&fsh_live, 1, __ATOMIC_RELAXED);
  return p;
}

void fsh_rt_free(void *p) {
  if (!p) return;
  __atomic_fetch_sub(&fsh_live, 1, __ATOMIC_RELAXED);
  free(p);
}

// What drops the program's top-level consts at exit, which the leak check runs first, unless tasks
// were left running, which may still read them.
static void (*fsh_constants_drop)(void) = NULL;

void fsh_rt_constants(void (*drop)(void)) {
  fsh_constants_drop = drop;
}

__attribute__((destructor)) static void fsh_leaks(void) {
  if (fsh_constants_drop && !fsh_abandoned) fsh_constants_drop();
  const char *check = getenv("FISH_LEAKS");
  int64_t live = __atomic_load_n(&fsh_live, __ATOMIC_RELAXED);
  if (check && check[0] == '1' && live != 0 && !fsh_abandoned) fprintf(stderr, "fish: leaked %lld allocations\n", (long long)live);
}

typedef struct fsh_str {
  int64_t count;
  int64_t length;
  const char *bytes;
  struct fsh_str *base;
  int64_t units;
  int64_t *crumbs;
  char own[];
} fsh_str;

// A string may be shared between tasks on different threads, so its count changes atomically.
void fsh_rt_str_retain(fsh_str *s) {
  if (s && __atomic_load_n(&s->count, __ATOMIC_RELAXED) >= 0) __atomic_fetch_add(&s->count, 1, __ATOMIC_RELAXED);
}

void fsh_rt_str_release(fsh_str *s) {
  if (!s || __atomic_load_n(&s->count, __ATOMIC_RELAXED) < 0 || __atomic_sub_fetch(&s->count, 1, __ATOMIC_ACQ_REL) > 0) return;
  fsh_rt_str_release(s->base);
  fsh_rt_free(s->crumbs);
  fsh_rt_free(s);
}

// A new block holding room for length bytes of its own, its UTF-16 length not yet known.
static fsh_str *fsh_str_new(int64_t length) {
  fsh_str *s = fsh_rt_alloc(sizeof(fsh_str) + length);
  s->count = 1;
  s->length = length;
  s->bytes = s->own;
  s->base = NULL;
  s->units = -1;
  s->crumbs = NULL;
  return s;
}

static fsh_str *fsh_str_of(const char *bytes, int64_t length) {
  fsh_str *s = fsh_str_new(length);
  memcpy(s->own, bytes, length);
  return s;
}

// Text is WTF-8: UTF-8, plus a lone surrogate in its 3-byte form, as JavaScript strings may
// hold one. A surrogate's 3-byte form starts ED A0 to ED BF; a high one ED A0 to ED AF.
static int fsh_high_at(const unsigned char *p) { return p[0] == 0xED && p[1] >= 0xA0 && p[1] <= 0xAF; }
static int fsh_low_at(const unsigned char *p) { return p[0] == 0xED && p[1] >= 0xB0 && p[1] <= 0xBF; }
static uint32_t fsh_three(const unsigned char *p) { return (p[0] & 0x0F) << 12 | (p[1] & 0x3F) << 6 | (p[2] & 0x3F); }

// The code point at byte at in s, as a new string, moving at past it; NULL past the end. A
// lone surrogate's 3-byte form is a code point of its own, as JavaScript's iterator gives one.
fsh_str *fsh_rt_str_next(fsh_str *s, int64_t *at) {
  if (*at >= s->length) return NULL;
  const unsigned char *p = (const unsigned char *)s->bytes + *at;
  int64_t n = p[0] < 0x80 ? 1 : p[0] < 0xE0 ? 2 : p[0] < 0xF0 ? 3 : 4;
  if (*at + n > s->length) n = s->length - *at;
  *at += n;
  return fsh_str_of((const char *)p, n);
}

// Joins strings. Where a lone high surrogate meets a lone low one, the two become the pair's
// 4-byte form, as joining them in JavaScript makes one character.
fsh_str *fsh_rt_str_join(fsh_str **parts, int64_t n) {
  int64_t length = 0, units = 0;
  for (int64_t i = 0; i < n; i++) {
    length += parts[i]->length;
    int64_t known = __atomic_load_n(&parts[i]->units, __ATOMIC_ACQUIRE);
    units = units < 0 || known < 0 ? -1 : units + known;
  }
  fsh_str *s = fsh_str_new(length);
  unsigned char *at = (unsigned char *)s->own;
  for (int64_t i = 0; i < n; i++) {
    const unsigned char *from = (const unsigned char *)parts[i]->bytes;
    int64_t size = parts[i]->length;
    if (size >= 3 && at - (unsigned char *)s->own >= 3 && fsh_high_at(at - 3) && fsh_low_at(from)) {
      uint32_t code = 0x10000 + ((fsh_three(at - 3) - 0xD800) << 10) + (fsh_three(from) - 0xDC00);
      at -= 3;
      *at++ = 0xF0 | code >> 18;
      *at++ = 0x80 | (code >> 12 & 0x3F);
      *at++ = 0x80 | (code >> 6 & 0x3F);
      *at++ = 0x80 | (code & 0x3F);
      from += 3;
      size -= 3;
    }
    memcpy(at, from, size);
    at += size;
  }
  s->length = at - (unsigned char *)s->own;
  s->units = units;
  return s;
}

fsh_str *fsh_rt_str_concat(fsh_str *a, fsh_str *b) {
  fsh_str *parts[2] = { a, b };
  return fsh_rt_str_join(parts, 2);
}

// The UTF-16 unit at byte *at, moving past it. A 4-byte character is two units: its high
// surrogate, leaving *at on the character with *half set, then its low one.
static uint32_t fsh_next(const unsigned char *s, int64_t *at, int *half) {
  const unsigned char *p = s + *at;
  uint32_t c = p[0];
  if (c < 0x80) { *at += 1; return c; }
  if (c < 0xE0) { *at += 2; return (c & 0x1F) << 6 | (p[1] & 0x3F); }
  if (c < 0xF0) { *at += 3; return fsh_three(p); }
  uint32_t code = (c & 0x07) << 18 | (p[1] & 0x3F) << 12 | (p[2] & 0x3F) << 6 | (p[3] & 0x3F);
  if (!*half) { *half = 1; return 0xD800 + ((code - 0x10000) >> 10); }
  *half = 0;
  *at += 4;
  return 0xDC00 + ((code - 0x10000) & 0x3FF);
}

// The UTF-16 length, counted once and kept.
int64_t fsh_rt_str_units(fsh_str *s) {
  int64_t known = __atomic_load_n(&s->units, __ATOMIC_ACQUIRE);
  if (known >= 0) return known;
  int64_t at = 0, n = 0;
  int half = 0;
  while (at < s->length) {
    fsh_next((const unsigned char *)s->bytes, &at, &half);
    n++;
  }
  __atomic_store_n(&s->units, n, __ATOMIC_RELEASE);
  return n;
}

// Breadcrumbs: where every 64th UTF-16 unit is, as its character's byte offset times two, plus
// one when the unit is a pair's second half. A literal's are made by the compiler.
#define FSH_STRIDE 64

// Two threads may build them at once; the first to finish installs its own, and the other
// frees what it built.
static void fsh_crumbs(fsh_str *s, int64_t units) {
  int64_t *crumbs = fsh_rt_alloc((units / FSH_STRIDE + 1) * sizeof(int64_t));
  int64_t at = 0;
  int half = 0;
  for (int64_t unit = 0; unit < units; unit++) {
    if (unit % FSH_STRIDE == 0) crumbs[unit / FSH_STRIDE] = at * 2 + half;
    fsh_next((const unsigned char *)s->bytes, &at, &half);
  }
  int64_t *none = NULL;
  if (!__atomic_compare_exchange_n(&s->crumbs, &none, crumbs, 0, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE)) fsh_rt_free(crumbs);
}

// Where UTF-16 unit i is: the byte its character starts at, and whether it is the second half
// of a pair. All-ASCII text is indexed directly; other text walks on from the breadcrumb at
// or before i, at most 63 units.
static int64_t fsh_seek(fsh_str *s, int64_t i, int *half) {
  *half = 0;
  int64_t units = fsh_rt_str_units(s);
  if (units == s->length) return i;
  if (i >= units) return s->length;
  int64_t at = 0, unit = 0;
  int64_t *crumbs = __atomic_load_n(&s->crumbs, __ATOMIC_ACQUIRE);
  if (!crumbs && __atomic_load_n(&s->count, __ATOMIC_RELAXED) >= 0 && units > FSH_STRIDE) {
    fsh_crumbs(s, units);
    crumbs = __atomic_load_n(&s->crumbs, __ATOMIC_ACQUIRE);
  }
  if (crumbs) {
    int64_t crumb = crumbs[i / FSH_STRIDE];
    at = crumb / 2;
    *half = crumb % 2;
    unit = i / FSH_STRIDE * FSH_STRIDE;
  }
  for (; unit < i; unit++) fsh_next((const unsigned char *)s->bytes, &at, half);
  return at;
}

uint16_t fsh_rt_str_unit(fsh_str *s, int64_t i) {
  int half;
  int64_t at = fsh_seek(s, i, &half);
  return fsh_next((const unsigned char *)s->bytes, &at, &half);
}

// The one-unit string at UTF-16 unit i: a character's own bytes, or for half of a pair, that
// lone surrogate, as JavaScript gives.
fsh_str *fsh_rt_str_at(fsh_str *s, int64_t i) {
  uint32_t u = fsh_rt_str_unit(s, i);
  char bytes[3];
  int n = 0;
  if (u < 0x80) bytes[n++] = u;
  else if (u < 0x800) {
    bytes[n++] = 0xC0 | u >> 6;
    bytes[n++] = 0x80 | (u & 0x3F);
  } else {
    bytes[n++] = 0xE0 | u >> 12;
    bytes[n++] = 0x80 | (u >> 6 & 0x3F);
    bytes[n++] = 0x80 | (u & 0x3F);
  }
  fsh_str *one = fsh_str_of(bytes, n);
  one->units = 1;
  return one;
}

// Searching. A search with no lone surrogate matches whole characters, so it compares bytes;
// one holding a lone surrogate may match half of a pair, so it compares UTF-16 units.
static int fsh_has_lone(fsh_str *s) {
  const unsigned char *p = (const unsigned char *)s->bytes;
  for (int64_t i = 0; i + 1 < s->length; i++) if (p[i] == 0xED && p[i + 1] >= 0xA0) return 1;
  return 0;
}

// The UTF-16 units of s, in a buffer the caller frees.
static uint16_t *fsh_utf16(fsh_str *s) {
  uint16_t *units = fsh_rt_alloc((fsh_rt_str_units(s) + 1) * sizeof(uint16_t));
  int64_t at = 0, n = 0;
  int half = 0;
  while (at < s->length) units[n++] = fsh_next((const unsigned char *)s->bytes, &at, &half);
  return units;
}

static int64_t fsh_clamp(int64_t i, int64_t n) {
  return i < 0 ? 0 : i > n ? n : i;
}

// Where needle first occurs in s at or after unit from, by units, or -1.
static int64_t fsh_find_units(fsh_str *s, fsh_str *needle, int64_t from) {
  int64_t n = fsh_rt_str_units(s), m = fsh_rt_str_units(needle), found = -1;
  uint16_t *a = fsh_utf16(s), *b = fsh_utf16(needle);
  for (int64_t i = from; found < 0 && i + m <= n; i++) {
    if (memcmp(a + i, b, m * sizeof(uint16_t)) == 0) found = i;
  }
  fsh_rt_free(a);
  fsh_rt_free(b);
  return found;
}

// The byte where whole characters start at or after unit i: past a pair whose second half i is.
static int64_t fsh_start_at(fsh_str *s, int64_t i) {
  int half;
  int64_t at = fsh_seek(s, i, &half);
  return half ? at + 4 : at;
}

// A match's unit is counted from where the search started, whose unit is known, so repeated
// searches along a string take linear time.
int64_t fsh_rt_str_index_of(fsh_str *s, fsh_str *needle, int64_t from) {
  int64_t n = fsh_rt_str_units(s);
  from = fsh_clamp(from, n);
  if (needle->length == 0) return from;
  if (fsh_has_lone(needle)) return fsh_find_units(s, needle, from);
  int half;
  int64_t start = fsh_seek(s, from, &half);
  int64_t unit = from;
  if (half) {
    start += 4;
    unit++;
  }
  for (int64_t at = start; at + needle->length <= s->length; at++) {
    if (memcmp(s->bytes + at, needle->bytes, needle->length) != 0) continue;
    if (n == s->length) return at;
    int h = 0;
    for (int64_t i = start; i < at; unit++) fsh_next((const unsigned char *)s->bytes, &i, &h);
    return unit;
  }
  return -1;
}

int32_t fsh_rt_str_starts_with(fsh_str *s, fsh_str *needle, int64_t position) {
  int64_t n = fsh_rt_str_units(s), m = fsh_rt_str_units(needle);
  position = fsh_clamp(position, n);
  if (m == 0) return 1;
  if (position + m > n) return 0;
  if (fsh_has_lone(needle)) return fsh_find_units(s, needle, position) == position;
  int half;
  int64_t at = fsh_seek(s, position, &half);
  return !half && at + needle->length <= s->length && memcmp(s->bytes + at, needle->bytes, needle->length) == 0;
}

int32_t fsh_rt_str_ends_with(fsh_str *s, fsh_str *needle, int64_t end) {
  int64_t n = fsh_rt_str_units(s), m = fsh_rt_str_units(needle);
  end = fsh_clamp(end, n);
  if (m == 0) return 1;
  if (end - m < 0) return 0;
  if (fsh_has_lone(needle)) return fsh_find_units(s, needle, end - m) == end - m;
  int half;
  int64_t at = fsh_seek(s, end, &half);
  return !half && at - needle->length >= 0 && memcmp(s->bytes + at - needle->length, needle->bytes, needle->length) == 0;
}

// Writes UTF-16 unit u, below 0x10000, as WTF-8.
static int fsh_put(char *out, uint32_t u) {
  if (u < 0x80) {
    out[0] = u;
    return 1;
  }
  if (u < 0x800) {
    out[0] = 0xC0 | u >> 6;
    out[1] = 0x80 | (u & 0x3F);
    return 2;
  }
  out[0] = 0xE0 | u >> 12;
  out[1] = 0x80 | (u >> 6 & 0x3F);
  out[2] = 0x80 | (u & 0x3F);
  return 3;
}

// Bytes [a, b) of s, starting and ending at characters, sharing the block they live in.
static fsh_str *fsh_share(fsh_str *s, int64_t a, int64_t b) {
  fsh_str *slice = fsh_rt_alloc(sizeof(fsh_str));
  slice->count = 1;
  slice->length = b - a;
  slice->bytes = s->bytes + a;
  slice->base = s->base ? s->base : s;
  fsh_rt_str_retain(slice->base);
  slice->units = -1;
  slice->crumbs = NULL;
  return slice;
}

// UTF-16 units [from, to) of s, with 0 <= from <= to <= its length. The slice shares the bytes
// of the block they live in; an end that cuts a pair makes it a copy holding that half as a
// lone surrogate.
// ponytail: a slice keeps its whole base alive, as a Swift substring does; copy small slices
// if pinned memory shows up.
static fsh_str *fsh_sub(fsh_str *s, int64_t from, int64_t to) {
  if (from == to) {
    fsh_str *empty = fsh_str_new(0);
    empty->units = 0;
    return empty;
  }
  int cut_start, cut_end;
  int64_t a = fsh_seek(s, from, &cut_start), b = fsh_seek(s, to, &cut_end);
  const unsigned char *bytes = (const unsigned char *)s->bytes;
  fsh_str *slice;
  if (!cut_start && !cut_end) {
    slice = fsh_share(s, a, b);
  } else {
    int64_t start = cut_start ? a + 4 : a;
    slice = fsh_str_new(3 + (b - start) + 3);
    char *out = slice->own;
    int half = 1;
    int64_t at = a;
    if (cut_start) out += fsh_put(out, fsh_next(bytes, &at, &half));
    memcpy(out, s->bytes + start, b - start);
    out += b - start;
    half = 0;
    at = b;
    if (cut_end) out += fsh_put(out, fsh_next(bytes, &at, &half));
    slice->length = out - slice->own;
  }
  slice->units = to - from;
  return slice;
}

// JavaScript's slice: a negative bound counts from the end, bounds clamp to the length, and
// reversed bounds give the empty string.
fsh_str *fsh_rt_str_slice(fsh_str *s, int64_t start, int64_t end, int32_t ended) {
  int64_t n = fsh_rt_str_units(s);
  if (!ended) end = n;
  start = start < 0 ? (start + n < 0 ? 0 : start + n) : (start > n ? n : start);
  end = end < 0 ? (end + n < 0 ? 0 : end + n) : (end > n ? n : end);
  return fsh_sub(s, start, start < end ? end : start);
}

// JavaScript's substring: bounds clamp to 0 and the length, and reversed bounds swap.
fsh_str *fsh_rt_str_substring(fsh_str *s, int64_t start, int64_t end, int32_t ended) {
  int64_t n = fsh_rt_str_units(s);
  if (!ended) end = n;
  start = start < 0 ? 0 : start > n ? n : start;
  end = end < 0 ? 0 : end > n ? n : end;
  return start < end ? fsh_sub(s, start, end) : fsh_sub(s, end, start);
}

// Whether this build aborts on a panic; the program's IR defines it, and this default serves a
// program without one.
__attribute__((weak)) const int32_t fsh_panic_abort = 0;

static _Unwind_Reason_Code fsh_unwound(int version, _Unwind_Action actions, _Unwind_Exception_Class kind,
                                       struct _Unwind_Exception *exception, struct _Unwind_Context *context, void *data) {
  if (actions & _UA_END_OF_STACK) exit(101);
  return _URC_NO_REASON;
}

// Every panic: the message, after what was already printed, then an abort, or an unwind that
// runs each frame's drops and exits with 101 once it reaches the end of the stack.
// Each thread's token, which marks the locks it holds. A panic leaves its locks held, and the
// thread takes a new token, so a task it runs next waits for them rather than seeing its own.
static int32_t fsh_tokens = 0;
static _Thread_local int32_t fsh_token = 0;

void fsh_rt_panic(const char *message) {
  static _Thread_local struct _Unwind_Exception exception;
  fsh_token = 0;
  fflush(NULL);
  fputs(message, stderr);
  if (fsh_panic_abort) abort();
  exception.exception_class = 0x46495348; // "FISH"
  _Unwind_ForcedUnwind(&exception, fsh_unwound, NULL);
  exit(101);
}

typedef struct { char *data; int64_t length; int64_t capacity; } fsh_array;

// Makes room for one more element of size bytes, doubling the buffer when it is full.
void fsh_rt_array_reserve(fsh_array *a, int64_t size) {
  if (a->length < a->capacity) return;
  int64_t capacity = a->capacity ? a->capacity * 2 : 4;
  char *data = fsh_rt_alloc(capacity * size);
  if (a->length) memcpy(data, a->data, a->length * size);
  fsh_rt_free(a->data);
  a->data = data;
  a->capacity = capacity;
}

// Makes room for at least need elements of size bytes, doubling the buffer as it grows.
static void fsh_array_room(fsh_array *a, int64_t need, int64_t size) {
  if (need <= a->capacity) return;
  int64_t capacity = a->capacity ? a->capacity : 4;
  while (capacity < need) capacity *= 2;
  char *data = fsh_rt_alloc(capacity * size);
  if (a->length) memcpy(data, a->data, a->length * size);
  fsh_rt_free(a->data);
  a->data = data;
  a->capacity = capacity;
}

// Makes room for at least more elements beyond the length, as Rust's Vec::reserve does. A
// negative count is no count at all.
void fsh_rt_array_grow(fsh_array *a, int64_t more, int64_t size, const char *at) {
  if (more < 0 || more > INT64_MAX / (size ? size : 1) - a->length) {
    fflush(NULL);
    fputs(at, stderr);
    fsh_rt_panic("capacity overflow\n");
  }
  if (a->length + more <= a->capacity) return;
  // Growing at least doubles, as pushes do, so a reserve before each push stays linear; from
  // nothing it gives exactly what was asked, as Rust's does.
  int64_t capacity = a->capacity * 2 > a->length + more ? a->capacity * 2 : a->length + more;
  char *data = fsh_rt_alloc(capacity * size);
  if (a->length) memcpy(data, a->data, a->length * size);
  fsh_rt_free(a->data);
  a->data = data;
  a->capacity = capacity;
}

// Gives back the room past the length, the whole buffer when the array is empty.
void fsh_rt_array_shrink(fsh_array *a, int64_t size) {
  if (a->capacity == a->length) return;
  char *data = a->length ? fsh_rt_alloc(a->length * size) : NULL;
  if (a->length) memcpy(data, a->data, a->length * size);
  fsh_rt_free(a->data);
  a->data = data;
  a->capacity = a->length;
}

// Moves every element of from onto the end of a, then frees from's buffer, whose elements
// now belong to a.
void fsh_rt_array_extend(fsh_array *a, fsh_array *from, int64_t size) {
  fsh_array_room(a, a->length + from->length, size);
  if (from->length) memcpy(a->data + a->length * size, from->data, from->length * size);
  a->length += from->length;
  fsh_rt_free(from->data);
}

// Opens count slots at index at, moving the elements from there up; the caller fills them.
void fsh_rt_array_open(fsh_array *a, int64_t at, int64_t count, int64_t size) {
  fsh_array_room(a, a->length + count, size);
  memmove(a->data + (at + count) * size, a->data + at * size, (a->length - at) * size);
  a->length += count;
}

// Moves count elements at index at out into a new array at out, closing the gap.
void fsh_rt_array_take(fsh_array *a, int64_t at, int64_t count, int64_t size, fsh_array *out) {
  out->data = count ? fsh_rt_alloc(count * size) : NULL;
  if (count) memcpy(out->data, a->data + at * size, count * size);
  out->length = out->capacity = count;
  memmove(a->data + at * size, a->data + (at + count) * size, (a->length - at - count) * size);
  a->length -= count;
}

// Reverses the elements in place, a byte at a time.
void fsh_rt_array_reverse(fsh_array *a, int64_t size) {
  for (int64_t i = 0, j = a->length - 1; i < j; i++, j--) {
    char *x = a->data + i * size, *y = a->data + j * size;
    for (int64_t b = 0; b < size; b++) {
      char t = x[b];
      x[b] = y[b];
      y[b] = t;
    }
  }
}

// A stable merge sort of n elements of size bytes each, by the sign of cmp(env, a, b), using a
// buffer of n elements. Each pair of runs merges into the buffer and is copied back before the
// next, so the array holds every element exactly once whenever a comparator runs, and a panic
// in one leaves it whole for its drop.
void fsh_rt_sort(char *data, int64_t n, int64_t size, int32_t (*cmp)(void *, void *, void *), void *env, char *buffer) {
  for (int64_t width = 1; width < n; width *= 2) {
    for (int64_t low = 0; low + width < n; low += 2 * width) {
      int64_t mid = low + width, high = low + 2 * width < n ? low + 2 * width : n;
      int64_t i = low, j = mid, k = low;
      // The right run's element goes first only when it orders strictly before, which keeps
      // equal elements in their order.
      while (i < mid && j < high) memcpy(buffer + size * k++, data + size * (cmp(env, data + size * j, data + size * i) < 0 ? j++ : i++), size);
      if (i < mid) memcpy(buffer + size * k, data + size * i, size * (mid - i)), k += mid - i;
      if (j < high) memcpy(buffer + size * k, data + size * j, size * (high - j));
      memcpy(data + size * low, buffer + size * low, size * (high - low));
    }
  }
}

// An array's buffer for this many bytes, or none for no elements.
void *fsh_rt_array_alloc(int64_t bytes) {
  return bytes == 0 ? NULL : fsh_rt_alloc(bytes);
}

// A Map or a Set: its entries in insertion order, each a state word (0 never used, 1 live, 2
// removed), the key's hash, the key's bits, then the key and value as the program lays them out,
// and an open-addressing index of entry numbers plus one. A key's bits are a sized integer
// widened to 64 bits, a union's member index, or with strings set a string's pointer, whose
// bytes are hashed and compared. Removed entries stay in place, keeping the order, until the
// entries grow and the live ones are moved together.
typedef struct {
  int64_t state, hash, bits;
} fsh_entry;

typedef struct {
  uint8_t *entries;
  int64_t used, live, cap;
  int64_t *index;
  int64_t slots;
  int64_t size, key_at, value_at;
  int32_t strings;
  void (*drop_key)(void *);
  void (*drop_value)(void *);
} fsh_map;

// Set once before main, so every thread hashes with the same seed.
static uint64_t fsh_map_seed = 0;

__attribute__((constructor)) static void fsh_map_seeding(void) {
  if (getentropy(&fsh_map_seed, sizeof fsh_map_seed) != 0) fsh_map_seed = (uint64_t)(intptr_t)&fsh_map_seed;
}

// ponytail: a seeded multiplicative hash, not SipHash; use SipHash-1-3 if hash flooding matters
static uint64_t fsh_map_hash(fsh_map *m, int64_t bits) {
  uint64_t h = fsh_map_seed;
  if (m->strings) {
    fsh_str *s = (fsh_str *)(intptr_t)bits;
    h ^= 0xcbf29ce484222325ull;
    for (int64_t i = 0; i < s->length; i++) h = (h ^ (unsigned char)s->bytes[i]) * 0x100000001b3ull;
  } else {
    h ^= (uint64_t)bits;
  }
  h = (h ^ (h >> 30)) * 0xbf58476d1ce4e5b9ull;
  h = (h ^ (h >> 27)) * 0x94d049bb133111ebull;
  return h ^ (h >> 31);
}

static int fsh_map_same(fsh_map *m, int64_t a, int64_t b) {
  if (!m->strings) return a == b;
  fsh_str *x = (fsh_str *)(intptr_t)a, *y = (fsh_str *)(intptr_t)b;
  return x->length == y->length && memcmp(x->bytes, y->bytes, x->length) == 0;
}

static fsh_entry *fsh_map_entry(fsh_map *m, int64_t i) {
  return (fsh_entry *)(m->entries + i * m->size);
}

static void fsh_map_reindex(fsh_map *m) {
  fsh_rt_free(m->index);
  m->slots = 8;
  while (m->slots < m->cap * 2) m->slots *= 2;
  m->index = fsh_rt_alloc(m->slots * sizeof(int64_t));
  memset(m->index, 0, m->slots * sizeof(int64_t));
  for (int64_t i = 0; i < m->used; i++) {
    fsh_entry *e = fsh_map_entry(m, i);
    if (e->state != 1) continue;
    uint64_t at = (uint64_t)e->hash & (m->slots - 1);
    while (m->index[at]) at = (at + 1) & (m->slots - 1);
    m->index[at] = i + 1;
  }
}

fsh_map *fsh_rt_map_new(int64_t size, int64_t key_at, int64_t value_at, int32_t strings, void (*drop_key)(void *), void (*drop_value)(void *)) {
  fsh_map *m = fsh_rt_alloc(sizeof(fsh_map));
  *m = (fsh_map){NULL, 0, 0, 0, NULL, 0, size, key_at, value_at, strings, drop_key, drop_value};
  return m;
}

// The entry holding a key, or -1.
int64_t fsh_rt_map_find(fsh_map *m, int64_t bits) {
  if (m->live == 0) return -1;
  uint64_t h = fsh_map_hash(m, bits);
  for (uint64_t at = h & (m->slots - 1); m->index[at]; at = (at + 1) & (m->slots - 1)) {
    fsh_entry *e = fsh_map_entry(m, m->index[at] - 1);
    if (e->state == 1 && e->hash == (int64_t)h && fsh_map_same(m, e->bits, bits)) return m->index[at] - 1;
  }
  return -1;
}

// The entry for a key, made at the end when the key is new; *found says whether it was there.
void *fsh_rt_map_insert(fsh_map *m, int64_t bits, int32_t *found) {
  int64_t i = fsh_rt_map_find(m, bits);
  *found = i >= 0;
  if (i >= 0) return fsh_map_entry(m, i);
  if (m->used == m->cap) {
    if (m->live <= m->used / 2 && m->used > 0) {
      int64_t to = 0;
      for (int64_t from = 0; from < m->used; from++) {
        if (fsh_map_entry(m, from)->state != 1) continue;
        if (to != from) memcpy(fsh_map_entry(m, to), fsh_map_entry(m, from), m->size);
        to++;
      }
      m->used = to;
    } else {
      m->cap = m->cap ? m->cap * 2 : 4;
      uint8_t *grown = fsh_rt_alloc(m->cap * m->size);
      if (m->used) memcpy(grown, m->entries, m->used * m->size);
      fsh_rt_free(m->entries);
      m->entries = grown;
    }
    fsh_map_reindex(m);
  }
  fsh_entry *e = fsh_map_entry(m, m->used);
  *e = (fsh_entry){1, (int64_t)fsh_map_hash(m, bits), bits};
  uint64_t at = (uint64_t)e->hash & (m->slots - 1);
  while (m->index[at]) at = (at + 1) & (m->slots - 1);
  m->index[at] = ++m->used;
  m->live++;
  return e;
}

// The entry a key was in, marked removed for the caller to drop its key and value, or NULL.
void *fsh_rt_map_remove(fsh_map *m, int64_t bits) {
  int64_t i = fsh_rt_map_find(m, bits);
  if (i < 0) return NULL;
  fsh_entry *e = fsh_map_entry(m, i);
  e->state = 2;
  m->live--;
  return e;
}

// Entry i, live or removed, for i below the number used.
void *fsh_rt_map_at(fsh_map *m, int64_t i) {
  return fsh_map_entry(m, i);
}

int64_t fsh_rt_map_used(fsh_map *m) {
  return m->used;
}

int64_t fsh_rt_map_size(fsh_map *m) {
  return m->live;
}

void fsh_rt_map_clear(fsh_map *m) {
  int64_t used = m->used;
  m->used = m->live = 0;
  for (int64_t i = 0; i < used; i++) {
    uint8_t *e = m->entries + i * m->size;
    if (((fsh_entry *)e)->state != 1) continue;
    if (m->drop_key) m->drop_key(e + m->key_at);
    if (m->drop_value) m->drop_value(e + m->value_at);
  }
  if (m->index) memset(m->index, 0, m->slots * sizeof(int64_t));
}

void fsh_rt_map_free(fsh_map *m) {
  if (!m) return;
  fsh_rt_map_clear(m);
  fsh_rt_free(m->entries);
  fsh_rt_free(m->index);
  fsh_rt_free(m);
}

// A copy of the table with its keys and values as bits, for the caller to copy each live one in
// place; until it does, the copy holds no live entry.
fsh_map *fsh_rt_map_copy(fsh_map *m) {
  fsh_map *c = fsh_rt_alloc(sizeof(fsh_map));
  *c = *m;
  c->entries = NULL;
  c->index = NULL;
  c->live = 0;
  if (m->cap) {
    c->entries = fsh_rt_alloc(m->cap * m->size);
    memcpy(c->entries, m->entries, m->used * m->size);
    c->index = fsh_rt_alloc(m->slots * sizeof(int64_t));
    memcpy(c->index, m->index, m->slots * sizeof(int64_t));
  }
  for (int64_t i = 0; i < c->used; i++) if (fsh_map_entry(c, i)->state == 1) fsh_map_entry(c, i)->state = 3;
  return c;
}

// Marks a copied entry live once its key and value are copied in.
void fsh_rt_map_copied(fsh_map *m, int64_t i, int64_t bits) {
  fsh_entry *e = fsh_map_entry(m, i);
  e->state = 1;
  e->bits = bits;
  m->live++;
}

static void fsh_add(fsh_array *out, fsh_str *s) {
  fsh_rt_array_reserve(out, sizeof(fsh_str *));
  ((fsh_str **)out->data)[out->length++] = s;
}

// JavaScript's split by a string, into at most limit parts (taken modulo 2^32, as JavaScript
// does): no separator gives the whole string; an empty one gives each UTF-16 unit.
void fsh_rt_str_split(fsh_array *out, fsh_str *s, fsh_str *separator, int64_t limit) {
  out->data = NULL;
  out->length = out->capacity = 0;
  uint32_t most = (uint32_t)limit;
  if (most == 0) return;
  int64_t n = fsh_rt_str_units(s);
  if (!separator) {
    fsh_rt_str_retain(s);
    return fsh_add(out, s);
  }
  int64_t m = fsh_rt_str_units(separator);
  if (m == 0) {
    for (int64_t i = 0; i < n && out->length < most; i++) fsh_add(out, fsh_sub(s, i, i + 1));
    return;
  }
  int64_t from = 0;
  if (fsh_has_lone(separator)) {
    // A separator holding a lone surrogate is matched by units, converted once.
    uint16_t *a = fsh_utf16(s), *b = fsh_utf16(separator);
    for (int64_t i = 0; out->length < most && i + m <= n;) {
      if (memcmp(a + i, b, m * sizeof(uint16_t)) != 0) {
        i++;
        continue;
      }
      fsh_add(out, fsh_sub(s, from, i));
      from = i += m;
    }
    fsh_rt_free(a);
    fsh_rt_free(b);
  } else {
    for (int64_t at; out->length < most && (at = fsh_rt_str_index_of(s, separator, from)) >= 0; from = at + m) fsh_add(out, fsh_sub(s, from, at));
  }
  if (out->length < most) fsh_add(out, fsh_sub(s, from, n));
}

// JavaScript's whitespace and line terminators, which trim removes.
static int fsh_space(uint32_t c) {
  return (c >= 0x09 && c <= 0x0D) || c == 0x20 || c == 0xA0 || c == 0x1680 || (c >= 0x2000 && c <= 0x200A) ||
         c == 0x2028 || c == 0x2029 || c == 0x202F || c == 0x205F || c == 0x3000 || c == 0xFEFF;
}

// Trims whitespace from the start (1), the end (2) or both (3), sharing what is left.
fsh_str *fsh_rt_str_trim(fsh_str *s, int32_t sides) {
  const unsigned char *p = (const unsigned char *)s->bytes;
  int64_t a = 0, b = s->length;
  int half = 0;
  while (sides & 1 && a < b) {
    int64_t next = a;
    if (!fsh_space(fsh_next(p, &next, &half)) || half) break;
    a = next;
  }
  while (sides & 2 && b > a) {
    int64_t start = b - 1;
    while (start > a && (p[start] & 0xC0) == 0x80) start--;
    int64_t at = start;
    half = 0;
    if (!fsh_space(fsh_next(p, &at, &half)) || half) break;
    b = start;
  }
  return fsh_share(s, a, b);
}

// Joins parts, then releases them: what building a string from slices ends with.
static fsh_str *fsh_join_parts(fsh_str **parts, int64_t n) {
  fsh_str *joined = fsh_rt_str_join(parts, n);
  for (int64_t i = 0; i < n; i++) fsh_rt_str_release(parts[i]);
  return joined;
}

// JavaScript's replace with a string pattern: the first match is replaced, and in the
// replacement $$ is $, $& the match, $ and a backtick (0x60) what comes before it, and $' what
// comes after.
fsh_str *fsh_rt_str_replace(fsh_str *s, fsh_str *pattern, fsh_str *replacement) {
  int64_t at = fsh_rt_str_index_of(s, pattern, 0);
  if (at < 0) {
    fsh_rt_str_retain(s);
    return s;
  }
  int64_t n = fsh_rt_str_units(s), end = at + fsh_rt_str_units(pattern);
  // At most: before, after, and a part per byte of the replacement.
  fsh_str **parts = fsh_rt_alloc((replacement->length + 3) * sizeof(fsh_str *));
  int64_t count = 0, from = 0;
  parts[count++] = fsh_sub(s, 0, at);
  const char *r = replacement->bytes;
  for (int64_t i = 0; i + 1 < replacement->length; i++) {
    if (r[i] != '$' || (r[i + 1] != '$' && r[i + 1] != '&' && r[i + 1] != 0x60 && r[i + 1] != '\'')) continue;
    parts[count++] = fsh_share(replacement, from, r[i + 1] == '$' ? i + 1 : i);
    if (r[i + 1] == '&') parts[count++] = fsh_sub(s, at, end);
    else if (r[i + 1] == 0x60) parts[count++] = fsh_sub(s, 0, at);
    else if (r[i + 1] == '\'') parts[count++] = fsh_sub(s, end, n);
    from = i + 2;
    i++;
  }
  parts[count++] = fsh_share(replacement, from, replacement->length);
  parts[count++] = fsh_sub(s, end, n);
  fsh_str *result = fsh_join_parts(parts, count);
  fsh_rt_free(parts);
  return result;
}

// The most bytes a string made by repeating may hold. Past it, making one panics, as
// JavaScript throws a RangeError; a usize count past i64's range arrives negative.
#define FSH_MAX_BYTES ((int64_t)1 << 40)

static void fsh_too_long(const char *at) {
  fflush(NULL);
  fputs(at, stderr);
  fsh_rt_panic("invalid string length\n");
}

fsh_str *fsh_rt_str_repeat(fsh_str *s, int64_t count, const char *at) {
  if (count < 0) fsh_too_long(at);
  if (count == 0 || s->length == 0) {
    fsh_str *empty = fsh_str_new(0);
    empty->units = 0;
    return empty;
  }
  if (count > FSH_MAX_BYTES / s->length) fsh_too_long(at);
  const unsigned char *b = (const unsigned char *)s->bytes;
  // A string ending in a lone high surrogate and starting with a lone low one joins a pair at
  // each seam, which joining does; at least six bytes each, the parts are no more than the text.
  if (s->length >= 6 && fsh_high_at(b + s->length - 3) && fsh_low_at(b)) {
    fsh_str **parts = fsh_rt_alloc(count * sizeof(fsh_str *));
    for (int64_t i = 0; i < count; i++) {
      fsh_rt_str_retain(s);
      parts[i] = s;
    }
    fsh_str *result = fsh_join_parts(parts, count);
    fsh_rt_free(parts);
    return result;
  }
  fsh_str *result = fsh_str_new(s->length * count);
  for (int64_t i = 0; i < count; i++) memcpy(result->own + i * s->length, s->bytes, s->length);
  int64_t known = __atomic_load_n(&s->units, __ATOMIC_ACQUIRE);
  result->units = known >= 0 ? known * count : -1;
  return result;
}

// JavaScript's padStart (start) or padEnd: the fill, a space by default, repeated and cut to
// make the string length units long.
fsh_str *fsh_rt_str_pad(fsh_str *s, int64_t length, fsh_str *fill, int32_t start, const char *at) {
  int64_t n = fsh_rt_str_units(s);
  fsh_str *space = fill ? NULL : fsh_str_of(" ", 1);
  if (!fill) fill = space;
  int64_t m = fsh_rt_str_units(fill);
  // An empty fill leaves the string as it is, however long it was asked to be. A length too
  // long to make panics before anything is held, so the unwind has nothing here to drop.
  if (m > 0 && (length < 0 || (length > n && (length - n) / m > FSH_MAX_BYTES / fill->length))) {
    fsh_rt_str_release(space);
    fsh_too_long(at);
  }
  if (length <= n || m == 0) {
    fsh_rt_str_release(space);
    fsh_rt_str_retain(s);
    return s;
  }
  int64_t missing = length - n;
  fsh_rt_str_retain(s);
  fsh_str *body = fsh_rt_str_repeat(fill, missing / m, at), *rest = fsh_sub(fill, 0, missing % m);
  fsh_str *parts[3] = { s, body, rest };
  if (start) {
    parts[0] = body;
    parts[1] = rest;
    parts[2] = s;
  }
  fsh_str *result = fsh_join_parts(parts, 3);
  fsh_rt_str_release(space);
  return result;
}

// An index past the end panics as Rust's does; at is the "panicked at" line.
void fsh_rt_panic_bounds(const char *at, int64_t length, int64_t index) {
  char reason[96];
  snprintf(reason, sizeof reason, "index out of bounds: the len is %lld but the index is %llu\n", (long long)length, (unsigned long long)index);
  fflush(NULL);
  fputs(at, stderr);
  fsh_rt_panic(reason);
}

// a < b, a === b and a > b as -1, 0 and 1, by UTF-16 code units as JavaScript orders strings.
// Past the bytes they share, both are read unit by unit from the character they differ in.
int32_t fsh_rt_str_compare(fsh_str *a, fsh_str *b) {
  int64_t n = a->length < b->length ? a->length : b->length;
  int64_t i = 0;
  while (i < n && a->bytes[i] == b->bytes[i]) i++;
  while (i > 0 && i < n && ((unsigned char)a->bytes[i] & 0xC0) == 0x80) i--;
  int64_t x = i, y = i;
  int hx = 0, hy = 0;
  while (x < a->length && y < b->length) {
    uint32_t u = fsh_next((const unsigned char *)a->bytes, &x, &hx), v = fsh_next((const unsigned char *)b->bytes, &y, &hy);
    if (u != v) return u < v ? -1 : 1;
  }
  return x < a->length ? 1 : y < b->length ? -1 : 0;
}

// A lone surrogate prints as U+FFFD, as a terminal shows one JavaScript prints.
void fsh_rt_str_print(int32_t stream, fsh_str *s) {
  FILE *out = stream == 2 ? stderr : stdout;
  const unsigned char *p = (const unsigned char *)s->bytes, *end = p + s->length, *from = p;
  for (; p + 2 < end; p++) {
    if (!fsh_high_at(p) && !fsh_low_at(p)) continue;
    fwrite(from, 1, p - from, out);
    fwrite("\xEF\xBF\xBD", 1, 3, out);
    from = p + 3;
    p += 2;
  }
  fwrite(from, 1, end - from, out);
}

// A NUL-terminated copy of a string's bytes for C, freed with fsh_rt_free; NULL when the string
// holds a NUL, which C would take for its end.
char *fsh_rt_str_cstring(fsh_str *s) {
  if (memchr(s->bytes, 0, s->length)) return NULL;
  char *c = fsh_rt_alloc(s->length + 1);
  memcpy(c, s->bytes, s->length);
  c[s->length] = 0;
  return c;
}

// A string of n bytes of UTF-8, decoded as the web's TextDecoder does: each byte that can't
// start a sequence, and each longest start of one that is cut short or broken, becomes U+FFFD.
static fsh_str *fsh_from_utf8(const unsigned char *p, size_t n) {
  fsh_str *s = fsh_str_new(n * 3);
  unsigned char *at = (unsigned char *)s->own;
  for (size_t i = 0; i < n;) {
    unsigned char b = p[i];
    int need = b < 0x80 ? 0 : b >= 0xC2 && b <= 0xDF ? 1 : b >= 0xE0 && b <= 0xEF ? 2 : b >= 0xF0 && b <= 0xF4 ? 3 : -1;
    // The second byte's range rules out overlong forms, surrogates and what is past U+10FFFF.
    unsigned char low = b == 0xE0 ? 0xA0 : b == 0xF0 ? 0x90 : 0x80, high = b == 0xED ? 0x9F : b == 0xF4 ? 0x8F : 0xBF;
    int k = 1;
    while (need > 0 && k <= need && i + k < n && p[i + k] >= (k == 1 ? low : 0x80) && p[i + k] <= (k == 1 ? high : 0xBF)) k++;
    if (need >= 0 && k > need) {
      memcpy(at, p + i, need + 1);
      at += need + 1;
      i += need + 1;
    } else {
      *at++ = 0xEF;
      *at++ = 0xBF;
      *at++ = 0xBD;
      i += need < 0 ? 1 : k;
    }
  }
  s->length = at - (unsigned char *)s->own;
  return s;
}

// A string of a C string's bytes up to its NUL.
fsh_str *fsh_rt_str_from_cstring(const char *c) {
  return fsh_from_utf8((const unsigned char *)c, strlen(c));
}

// 'new TextDecoder().decode(bytes)'.
// A leading byte order mark is dropped, as the web's decoder does by default.
fsh_str *fsh_rt_utf8_decode(fsh_array *bytes) {
  const unsigned char *p = (const unsigned char *)bytes->data;
  int bom = bytes->length >= 3 && p[0] == 0xEF && p[1] == 0xBB && p[2] == 0xBF;
  return fsh_from_utf8(p + (bom ? 3 : 0), bytes->length - (bom ? 3 : 0));
}

// A shared Dyn's block: its count sits 16 bytes before the value, which keeps its alignment.
void *fsh_rt_dyn_alloc(int64_t size) {
  char *raw = fsh_rt_alloc(size + 16);
  *(int64_t *)raw = 1;
  return raw + 16;
}

void *fsh_rt_dyn_retain(char *p) {
  __atomic_add_fetch((int64_t *)(p - 16), 1, __ATOMIC_RELAXED);
  return p;
}

// Whether this was the last count, so the value is dropped and the block freed.
_Bool fsh_rt_dyn_release(char *p) {
  return __atomic_sub_fetch((int64_t *)(p - 16), 1, __ATOMIC_ACQ_REL) == 0;
}

void fsh_rt_dyn_free(char *p) {
  fsh_rt_free(p - 16);
}

// Milliseconds on the monotonic clock.
int64_t fsh_rt_now_ms(void) {
  struct timespec now;
  clock_gettime(CLOCK_MONOTONIC, &now);
  return (int64_t)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}

// The time now as an HTTP Date header writes it, like "Sun, 06 Nov 1994 08:49:37 GMT".
fsh_str *fsh_rt_http_date(void) {
  time_t now = time(NULL);
  struct tm at;
  gmtime_r(&now, &at);
  char text[64];
  strftime(text, sizeof text, "%a, %d %b %Y %H:%M:%S GMT", &at);
  return fsh_rt_str_from_cstring(text);
}

// 'new TextEncoder().encode(s)': its UTF-8 bytes, a lone surrogate becoming U+FFFD, whose
// encoding is as long.
void fsh_rt_utf8_encode(fsh_array *out, fsh_str *s) {
  out->data = fsh_rt_array_alloc(s->length);
  out->length = out->capacity = s->length;
  if (!s->length) return;
  memcpy(out->data, s->bytes, s->length);
  unsigned char *p = (unsigned char *)out->data;
  for (int64_t i = 0; i + 2 < s->length; i++) {
    if (p[i] == 0xED && p[i + 1] >= 0xA0) {
      p[i] = 0xEF;
      p[i + 1] = 0xBF;
      p[i + 2] = 0xBD;
      i += 2;
    }
  }
}

fsh_str *fsh_rt_str_from_i64(int64_t v) {
  char text[24];
  int n = snprintf(text, sizeof text, "%lld", (long long)v);
  return fsh_str_of(text, n);
}

fsh_str *fsh_rt_str_from_u64(uint64_t v) {
  char text[24];
  int n = snprintf(text, sizeof text, "%llu", (unsigned long long)v);
  return fsh_str_of(text, n);
}

static char *fsh_format(double x, int single, char *out) {
  if (isnan(x)) return strcpy(out, "NaN");
  if (isinf(x)) return strcpy(out, x < 0 ? "-Infinity" : "Infinity");
  if (x == 0) return strcpy(out, "0");
  char sci[40];
  for (int p = 1; p <= 17; p++) {
    snprintf(sci, sizeof sci, "%.*e", p - 1, x);
    if (single ? strtof(sci, NULL) == (float)x : strtod(sci, NULL) == x) break;
  }
  // sci is [-]d[.ddd]e(+|-)XX: gather the digits, without trailing zeros, and the exponent.
  char digits[24];
  int k = 0;
  const char *s = sci;
  int negative = *s == '-';
  if (negative) s++;
  for (; *s != 'e'; s++) if (*s != '.') digits[k++] = *s;
  while (k > 1 && digits[k - 1] == '0') k--;
  digits[k] = 0;
  int n = atoi(s + 1) + 1;
  char *o = out;
  if (negative) *o++ = '-';
  if (k <= n && n <= 21) {
    memcpy(o, digits, k);
    o += k;
    for (int i = k; i < n; i++) *o++ = '0';
  } else if (0 < n && n <= 21) {
    memcpy(o, digits, n);
    o += n;
    *o++ = '.';
    memcpy(o, digits + n, k - n);
    o += k - n;
  } else if (-6 < n && n <= 0) {
    *o++ = '0';
    *o++ = '.';
    for (int i = 0; i < -n; i++) *o++ = '0';
    memcpy(o, digits, k);
    o += k;
  } else {
    *o++ = digits[0];
    if (k > 1) {
      *o++ = '.';
      memcpy(o, digits + 1, k - 1);
      o += k - 1;
    }
    o += sprintf(o, "e%c%d", n - 1 < 0 ? '-' : '+', abs(n - 1));
  }
  *o = 0;
  return out;
}

// The bytes of JavaScript white space or a line terminator starting at p, or 0: what parseInt,
// parseFloat and Number skip.
static int64_t fsh_js_space(const unsigned char *p, int64_t n) {
  if (n >= 1 && (p[0] == ' ' || (p[0] >= '\t' && p[0] <= '\r'))) return 1;
  if (n >= 2 && p[0] == 0xC2 && p[1] == 0xA0) return 2;
  if (n < 3) return 0;
  if (p[0] == 0xE1 && p[1] == 0x9A && p[2] == 0x80) return 3;
  if (p[0] == 0xE2 && p[1] == 0x80 && (p[2] <= 0x8A || p[2] == 0xA8 || p[2] == 0xA9 || p[2] == 0xAF)) return 3;
  if (p[0] == 0xE2 && p[1] == 0x81 && p[2] == 0x9F) return 3;
  if (p[0] == 0xE3 && p[1] == 0x80 && p[2] == 0x80) return 3;
  if (p[0] == 0xEF && p[1] == 0xBB && p[2] == 0xBF) return 3;
  return 0;
}

static int64_t fsh_js_skip(const unsigned char *p, int64_t n) {
  int64_t i = 0, w;
  while (i < n && (w = fsh_js_space(p + i, n - i)) > 0) i += w;
  return i;
}

static int fsh_digit(unsigned char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'z') return c - 'a' + 10;
  if (c >= 'A' && c <= 'Z') return c - 'A' + 10;
  return 99;
}

// JavaScript's parseInt, its NaN as a false result: white space, a sign, '0x' when the radix is
// 16 or not given (0), then the longest run of digits. A value past the i64 range is false too.
int fsh_rt_parse_int(fsh_str *s, int64_t radix, int64_t *out) {
  const unsigned char *p = s ? (const unsigned char *)s->bytes : NULL;
  int64_t n = s ? s->length : 0, i = fsh_js_skip(p, n);
  int negative = i < n && p[i] == '-';
  if (i < n && (p[i] == '-' || p[i] == '+')) i++;
  if (radix != 0 && (radix < 2 || radix > 36)) return 0;
  if ((radix == 0 || radix == 16) && i + 1 < n && p[i] == '0' && (p[i + 1] == 'x' || p[i + 1] == 'X')) {
    i += 2;
    radix = 16;
  }
  if (radix == 0) radix = 10;
  int64_t v = 0, start = i;
  for (; i < n && fsh_digit(p[i]) < radix; i++) {
    int64_t d = fsh_digit(p[i]);
    if (__builtin_mul_overflow(v, radix, &v) || (negative ? __builtin_sub_overflow(v, d, &v) : __builtin_add_overflow(v, d, &v))) return 0;
  }
  *out = v;
  return i > start;
}

// The length of the longest StrDecimalLiteral at p, without its sign: digits with an optional
// fraction, or a fraction alone, then an optional exponent, or 'Infinity'; 0 when there is none.
static int64_t fsh_js_decimal(const unsigned char *p, int64_t n) {
  if (n >= 8 && memcmp(p, "Infinity", 8) == 0) return 8;
  int64_t i = 0, digits = 0;
  while (i < n && p[i] >= '0' && p[i] <= '9') i++, digits++;
  if (i < n && p[i] == '.') {
    i++;
    while (i < n && p[i] >= '0' && p[i] <= '9') i++, digits++;
  }
  if (digits == 0) return 0;
  if (i < n && (p[i] == 'e' || p[i] == 'E')) {
    int64_t j = i + 1;
    if (j < n && (p[j] == '+' || p[j] == '-')) j++;
    if (j < n && p[j] >= '0' && p[j] <= '9') {
      while (j < n && p[j] >= '0' && p[j] <= '9') j++;
      i = j;
    }
  }
  return i;
}

// The double a decimal literal of 'length' bytes at p reads as, sign included.
static double fsh_js_strtod(const unsigned char *p, int64_t length) {
  int negative = length > 0 && p[0] == '-';
  int64_t sign = length > 0 && (p[0] == '-' || p[0] == '+');
  if (length - sign == 8 && memcmp(p + sign, "Infinity", 8) == 0) return negative ? -INFINITY : INFINITY;
  char *text = fsh_rt_alloc(length + 1);
  memcpy(text, p, length);
  text[length] = 0;
  double v = strtod(text, NULL);
  fsh_rt_free(text);
  return v;
}

// JavaScript's parseFloat, its NaN as a false result: white space, then the longest decimal
// literal with an optional sign.
int fsh_rt_parse_float(fsh_str *s, double *out) {
  const unsigned char *p = s ? (const unsigned char *)s->bytes : NULL;
  int64_t n = s ? s->length : 0, i = fsh_js_skip(p, n);
  int64_t sign = i < n && (p[i] == '-' || p[i] == '+');
  int64_t length = fsh_js_decimal(p + i + sign, n - i - sign);
  if (length == 0) return 0;
  *out = fsh_js_strtod(p + i, sign + length);
  return 1;
}

// JavaScript's Number of a string, its NaN as a false result: the whole string less white space
// at both ends is empty, giving 0, a '0x', '0o' or '0b' integer, or a decimal literal.
int fsh_rt_parse_number(fsh_str *s, double *out) {
  const unsigned char *p = s ? (const unsigned char *)s->bytes : NULL;
  int64_t n = s ? s->length : 0, i = fsh_js_skip(p, n);
  for (int64_t k = 1; n > i && k <= 3 && k <= n - i;) {
    if (fsh_js_space(p + n - k, k) == k) {
      n -= k;
      k = 1;
    } else k++;
  }
  if (i == n) {
    *out = 0;
    return 1;
  }
  if (n - i > 2 && p[i] == '0') {
    int radix = p[i + 1] == 'x' || p[i + 1] == 'X' ? 16 : p[i + 1] == 'o' || p[i + 1] == 'O' ? 8 : p[i + 1] == 'b' || p[i + 1] == 'B' ? 2 : 0;
    if (radix != 0) {
      // The top 64 bits, the last one also standing for any 1 below them, round once to a
      // double as an exact value would.
      int bits = radix == 16 ? 4 : radix == 8 ? 3 : 1, used = 0, sticky = 0;
      uint64_t top = 0;
      int64_t shift = 0;
      for (int64_t k = i + 2; k < n; k++) {
        int d = fsh_digit(p[k]);
        if (d >= radix) return 0;
        for (int b = bits - 1; b >= 0; b--) {
          int bit = (d >> b) & 1;
          if (used == 0 && bit == 0) continue;
          if (used < 64) {
            top = top << 1 | bit;
            used++;
          } else {
            shift++;
            sticky |= bit;
          }
        }
      }
      *out = ldexp((double)(top | (uint64_t)sticky), (int)(shift > 2000 ? 2000 : shift));
      return 1;
    }
  }
  int64_t sign = p[i] == '-' || p[i] == '+';
  int64_t length = fsh_js_decimal(p + i + sign, n - i - sign);
  if (length == 0 || length != n - i - sign) return 0;
  *out = fsh_js_strtod(p + i, n - i);
  return 1;
}

char *fsh_rt_format_f64(double x, char *out) { return fsh_format(x, 0, out); }

fsh_str *fsh_rt_str_from_f64(double x);

// JavaScript's toFixed: the integer nearest x times 10 to the digits, the larger of two equally
// near, from x's exact decimal expansion, which printf gives; NaN and anything from 1e21 up
// print as they otherwise would.
fsh_str *fsh_rt_to_fixed(double x, int64_t f) {
  if (x != x || fabs(x) >= 1e21) return fsh_rt_str_from_f64(x);
  char exact[1200];
  snprintf(exact, sizeof exact, "%.1100f", fabs(x));
  int64_t whole = strchr(exact, '.') - exact;
  char *digits = fsh_rt_alloc(whole + f + 3);
  digits[0] = '0';
  memcpy(digits + 1, exact, whole);
  memcpy(digits + 1 + whole, exact + whole + 1, f);
  if (exact[whole + 1 + f] >= '5') {
    int64_t i = whole + f;
    for (; digits[i] == '9'; i--) digits[i] = '0';
    digits[i]++;
  }
  int64_t lead = digits[0] == '0' ? 1 : 0;
  char *out = fsh_rt_alloc(whole + f + 4);
  int64_t n = 0;
  if (x < 0) out[n++] = '-';
  memcpy(out + n, digits + lead, whole + 1 - lead);
  n += whole + 1 - lead;
  if (f > 0) {
    out[n++] = '.';
    memcpy(out + n, digits + 1 + whole, f);
    n += f;
  }
  fsh_str *s = fsh_str_of(out, n);
  fsh_rt_free(digits);
  fsh_rt_free(out);
  return s;
}

fsh_str *fsh_rt_int_to_fixed(int64_t v, int32_t is_signed, int64_t f) {
  char text[24];
  int n = is_signed ? snprintf(text, sizeof text, "%lld", (long long)v) : snprintf(text, sizeof text, "%llu", (unsigned long long)v);
  fsh_str *s = fsh_str_new(n + (f > 0 ? f + 1 : 0));
  memcpy(s->own, text, n);
  if (f > 0) {
    s->own[n] = '.';
    memset(s->own + n + 1, '0', f);
  }
  return s;
}
char *fsh_rt_format_f32(float x, char *out) { return fsh_format(x, 1, out); }

fsh_str *fsh_rt_str_from_f64(double x) {
  char text[32];
  fsh_format(x, 0, text);
  return fsh_str_of(text, strlen(text));
}

fsh_str *fsh_rt_str_from_f32(float x) {
  char text[32];
  fsh_format(x, 1, text);
  return fsh_str_of(text, strlen(text));
}

// JSON text being written, in a buffer that doubles as it fills.
typedef struct fsh_json_out {
  char *bytes;
  int64_t length;
  int64_t room;
} fsh_json_out;

fsh_json_out *fsh_rt_json_new(void) {
  fsh_json_out *w = fsh_rt_alloc(sizeof(fsh_json_out));
  w->room = 64;
  w->length = 0;
  w->bytes = fsh_rt_alloc(w->room);
  return w;
}

void fsh_rt_json_raw(fsh_json_out *w, const char *p, int64_t n) {
  if (w->length + n > w->room) {
    int64_t room = w->room * 2;
    while (room < w->length + n) room *= 2;
    char *bytes = fsh_rt_alloc(room);
    memcpy(bytes, w->bytes, w->length);
    fsh_rt_free(w->bytes);
    w->bytes = bytes;
    w->room = room;
  }
  memcpy(w->bytes + w->length, p, n);
  w->length += n;
}

void fsh_rt_json_i64(fsh_json_out *w, int64_t v) {
  char text[24];
  fsh_rt_json_raw(w, text, snprintf(text, sizeof text, "%lld", (long long)v));
}

void fsh_rt_json_u64(fsh_json_out *w, uint64_t v) {
  char text[24];
  fsh_rt_json_raw(w, text, snprintf(text, sizeof text, "%llu", (unsigned long long)v));
}

// JSON has no NaN or infinities, which JavaScript writes as null.
void fsh_rt_json_f64(fsh_json_out *w, double x, int32_t single) {
  if (isnan(x) || isinf(x)) {
    fsh_rt_json_raw(w, "null", 4);
    return;
  }
  char text[32];
  fsh_format(x, single, text);
  fsh_rt_json_raw(w, text, strlen(text));
}

// A string as JSON.stringify writes it: quotes, backslashes and control characters escaped, and
// a lone surrogate as its escape of four hex digits, so the text is well-formed UTF-8.
void fsh_rt_json_string(fsh_json_out *w, fsh_str *s) {
  const unsigned char *p = (const unsigned char *)s->bytes;
  int64_t n = s->length, from = 0, i = 0;
  fsh_rt_json_raw(w, "\"", 1);
  while (i < n) {
    unsigned char c = p[i];
    char hex[8];
    const char *escape = NULL;
    int64_t width = 1;
    if (c == '"') escape = "\\\"";
    else if (c == '\\') escape = "\\\\";
    else if (c == '\b') escape = "\\b";
    else if (c == '\f') escape = "\\f";
    else if (c == '\n') escape = "\\n";
    else if (c == '\r') escape = "\\r";
    else if (c == '\t') escape = "\\t";
    else if (c < 0x20) {
      snprintf(hex, sizeof hex, "\\" "u%04x", c);
      escape = hex;
    } else if (i + 2 < n && (fsh_high_at(p + i) || fsh_low_at(p + i))) {
      snprintf(hex, sizeof hex, "\\" "u%04x", fsh_three(p + i));
      escape = hex;
      width = 3;
    }
    if (!escape) {
      i++;
      continue;
    }
    fsh_rt_json_raw(w, (const char *)p + from, i - from);
    fsh_rt_json_raw(w, escape, strlen(escape));
    i += width;
    from = i;
  }
  fsh_rt_json_raw(w, (const char *)p + from, n - from);
  fsh_rt_json_raw(w, "\"", 1);
}

fsh_str *fsh_rt_json_done(fsh_json_out *w) {
  fsh_str *s = fsh_str_of(w->bytes, w->length);
  fsh_rt_free(w->bytes);
  fsh_rt_free(w);
  return s;
}
` + CASEMAP + String.raw`
// A code point found in a sorted table of pairs, by its first column.
static const uint32_t *fsh_lookup(const uint32_t (*table)[2], int64_t n, uint32_t cp) {
  int64_t lo = 0, hi = n - 1;
  while (lo <= hi) {
    int64_t mid = (lo + hi) / 2;
    if (table[mid][0] == cp) return table[mid];
    if (table[mid][0] < cp) lo = mid + 1;
    else hi = mid - 1;
  }
  return NULL;
}

static int fsh_in(const uint32_t (*ranges)[2], int64_t n, uint32_t cp) {
  int64_t lo = 0, hi = n - 1;
  while (lo <= hi) {
    int64_t mid = (lo + hi) / 2;
    if (cp < ranges[mid][0]) hi = mid - 1;
    else if (cp > ranges[mid][1]) lo = mid + 1;
    else return 1;
  }
  return 0;
}

#define FSH_COUNT(t) ((int64_t)(sizeof(t) / sizeof(t[0])))

// The code points of WTF-8 text, a lone surrogate as itself, in a buffer the caller frees.
static uint32_t *fsh_code_points(fsh_str *s, int64_t *n) {
  uint32_t *cps = fsh_rt_alloc((s->length + 1) * sizeof(uint32_t));
  const unsigned char *p = (const unsigned char *)s->bytes;
  *n = 0;
  for (int64_t at = 0; at < s->length;) {
    uint32_t c = p[at];
    if (c < 0x80) at += 1;
    else if (c < 0xE0) c = (c & 0x1F) << 6 | (p[at + 1] & 0x3F), at += 2;
    else if (c < 0xF0) c = fsh_three(p + at), at += 3;
    else c = (c & 0x07) << 18 | (p[at + 1] & 0x3F) << 12 | (p[at + 2] & 0x3F) << 6 | (p[at + 3] & 0x3F), at += 4;
    cps[(*n)++] = c;
  }
  return cps;
}

static char *fsh_put_cp(char *out, uint32_t c) {
  if (c < 0x10000) return out + fsh_put(out, c);
  *out++ = 0xF0 | c >> 18;
  *out++ = 0x80 | (c >> 12 & 0x3F);
  *out++ = 0x80 | (c >> 6 & 0x3F);
  *out++ = 0x80 | (c & 0x3F);
  return out;
}

// Whether a capital sigma at i ends a word, so it lowers to a final sigma: a cased letter
// comes before it and none after, skipping case-ignorable ones, as JavaScript's rule says.
static int fsh_final_sigma(const uint32_t *cps, int64_t n, int64_t i) {
  int64_t j = i - 1;
  while (j >= 0 && fsh_in(fsh_case_ignorable, FSH_COUNT(fsh_case_ignorable), cps[j])) j--;
  if (j < 0 || !fsh_in(fsh_cased, FSH_COUNT(fsh_cased), cps[j])) return 0;
  j = i + 1;
  while (j < n && fsh_in(fsh_case_ignorable, FSH_COUNT(fsh_case_ignorable), cps[j])) j++;
  return j >= n || !fsh_in(fsh_cased, FSH_COUNT(fsh_cased), cps[j]);
}

// JavaScript's toUpperCase (upper) or toLowerCase, code point by code point. A code point may
// become up to three, each at most three times its bytes, so three times the length is room.
fsh_str *fsh_rt_str_case(fsh_str *s, int32_t upper) {
  int64_t n;
  uint32_t *cps = fsh_code_points(s, &n);
  fsh_str *out = fsh_str_new(s->length * 3);
  char *at = out->own;
  const uint32_t (*simple)[2] = upper ? fsh_upper : fsh_lower;
  const uint32_t (*special)[4] = upper ? fsh_upper_special : fsh_lower_special;
  int64_t simples = upper ? FSH_COUNT(fsh_upper) : FSH_COUNT(fsh_lower);
  int64_t specials = upper ? FSH_COUNT(fsh_upper_special) : FSH_COUNT(fsh_lower_special);
  for (int64_t i = 0; i < n; i++) {
    uint32_t c = cps[i];
    if (!upper && c == 0x3A3) {
      at = fsh_put_cp(at, fsh_final_sigma(cps, n, i) ? 0x3C2 : 0x3C3);
      continue;
    }
    const uint32_t *found = fsh_lookup(simple, simples, c);
    if (found) {
      at = fsh_put_cp(at, found[1]);
      continue;
    }
    int64_t lo = 0, hi = specials - 1, k = -1;
    while (lo <= hi && k < 0) {
      int64_t mid = (lo + hi) / 2;
      if (special[mid][0] == c) k = mid;
      else if (special[mid][0] < c) lo = mid + 1;
      else hi = mid - 1;
    }
    if (k < 0) {
      at = fsh_put_cp(at, c);
      continue;
    }
    for (int x = 1; x < 4 && special[k][x]; x++) at = fsh_put_cp(at, special[k][x]);
  }
  out->length = at - out->own;
  fsh_rt_free(cps);
  return out;
}

// The async runtime: tasks polled by one worker thread per core.
//
// A task is a block holding a future's frame, the functions that poll it, drop it and drop
// what it gave, then the poll result it finished with. Its state says whether it is waiting
// (idle), queued, being polled, being polled after a wake, or done. It is freed when the last
// of its references goes: the runtime's while it is alive, each JoinHandle, each timer.
enum { FSH_IDLE, FSH_QUEUED, FSH_RUNNING, FSH_NOTIFIED, FSH_DONE };

typedef struct fsh_task fsh_task;
typedef int32_t (*fsh_poll_fn)(fsh_task *task, void *frame);
typedef void (*fsh_drop_fn)(void *frame);
struct fsh_task {
  int32_t state;
  int32_t outcome;
  int64_t refs;
  fsh_poll_fn poll;
  fsh_drop_fn drop;
  fsh_drop_fn drop_output;
  fsh_task *joiner;
  fsh_task *prev, *next;
  int64_t frame_size;
  int64_t output_size;
  char memory[];
};

static void *fsh_output(fsh_task *t) { return t->memory + t->frame_size; }

// A worker's queue: a ring of tasks, guarded by its own lock, which other workers steal from.
typedef struct {
  pthread_mutex_t lock;
  fsh_task **ring;
  int64_t head, count, capacity;
} fsh_queue;

static int64_t fsh_workers = 0;
static fsh_queue *fsh_queues = NULL;
static fsh_queue fsh_injected = { PTHREAD_MUTEX_INITIALIZER, NULL, 0, 0, 0 };
static pthread_t *fsh_threads = NULL;
static _Thread_local int64_t fsh_worker = -1;
// Workers with nothing to do wait here until a task is queued or the runtime stops.
static pthread_mutex_t fsh_park = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t fsh_parked = PTHREAD_COND_INITIALIZER;
static int64_t fsh_queued = 0;
static int32_t fsh_stopping = 0;
static int64_t fsh_stopped = 0;
static pthread_cond_t fsh_left = PTHREAD_COND_INITIALIZER;
// The tasks not yet done, dropped when the runtime stops; and how the program ends.
static pthread_mutex_t fsh_alive_lock = PTHREAD_MUTEX_INITIALIZER;
static fsh_task *fsh_alive = NULL;
static pthread_cond_t fsh_finished = PTHREAD_COND_INITIALIZER;
static int32_t fsh_panicked = 0;
static fsh_task *fsh_main_task = NULL;

static void fsh_push(fsh_queue *q, fsh_task *t) {
  pthread_mutex_lock(&q->lock);
  if (q->count == q->capacity) {
    int64_t capacity = q->capacity ? q->capacity * 2 : 64;
    fsh_task **ring = malloc(capacity * sizeof(fsh_task *));
    for (int64_t i = 0; i < q->count; i++) ring[i] = q->ring[(q->head + i) % q->capacity];
    free(q->ring);
    q->ring = ring;
    q->head = 0;
    q->capacity = capacity;
  }
  q->ring[(q->head + q->count) % q->capacity] = t;
  q->count++;
  pthread_mutex_unlock(&q->lock);
}

static fsh_task *fsh_pop(fsh_queue *q) {
  pthread_mutex_lock(&q->lock);
  fsh_task *t = NULL;
  if (q->count > 0) {
    t = q->ring[q->head];
    q->head = (q->head + 1) % q->capacity;
    q->count--;
  }
  pthread_mutex_unlock(&q->lock);
  return t;
}

// Queues a task: on the waking worker's own queue, or from any other thread on the shared
// one, then lets a parked worker know.
static void fsh_schedule(fsh_task *t) {
  fsh_push(fsh_worker >= 0 ? &fsh_queues[fsh_worker] : &fsh_injected, t);
  pthread_mutex_lock(&fsh_park);
  __atomic_fetch_add(&fsh_queued, 1, __ATOMIC_RELAXED);
  pthread_cond_signal(&fsh_parked);
  pthread_mutex_unlock(&fsh_park);
}

void fsh_task_release(fsh_task *t) {
  if (__atomic_sub_fetch(&t->refs, 1, __ATOMIC_ACQ_REL) > 0) return;
  if (t->outcome) t->drop_output(fsh_output(t));
  fsh_rt_free(t);
}

// A waker: runs the task again soon. Waking one being polled has it polled again after.
void fsh_rt_wake(fsh_task *t) {
  for (;;) {
    int32_t state = __atomic_load_n(&t->state, __ATOMIC_ACQUIRE);
    if (state == FSH_IDLE) {
      if (__atomic_compare_exchange_n(&t->state, &state, FSH_QUEUED, 0, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE)) return fsh_schedule(t);
    } else if (state == FSH_RUNNING) {
      if (__atomic_compare_exchange_n(&t->state, &state, FSH_NOTIFIED, 0, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE)) return;
    } else return;
  }
}

static void fsh_unlink(fsh_task *t) {
  if (t->prev) t->prev->next = t->next;
  else fsh_alive = t->next;
  if (t->next) t->next->prev = t->prev;
  t->prev = t->next = NULL;
}

// Polls a task once. Pending, it waits for a wake, or goes round again if one came while it
// ran. Finished, its output is kept and whoever awaits it is woken.
static void fsh_run(fsh_task *t) {
  __atomic_store_n(&t->state, FSH_RUNNING, __ATOMIC_RELEASE);
  int32_t result = t->poll(t, t->memory);
  if (result == 3) {
    pthread_mutex_lock(&fsh_alive_lock);
    fsh_panicked = 1;
    pthread_cond_broadcast(&fsh_finished);
    pthread_mutex_unlock(&fsh_alive_lock);
    return;
  }
  if (result == 0) {
    int32_t running = FSH_RUNNING;
    if (__atomic_compare_exchange_n(&t->state, &running, FSH_IDLE, 0, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE)) return;
    __atomic_store_n(&t->state, FSH_QUEUED, __ATOMIC_RELEASE);
    return fsh_schedule(t);
  }
  pthread_mutex_lock(&fsh_alive_lock);
  t->outcome = result;
  __atomic_store_n(&t->state, FSH_DONE, __ATOMIC_RELEASE);
  fsh_unlink(t);
  fsh_task *joiner = t->joiner;
  t->joiner = NULL;
  if (t == fsh_main_task) pthread_cond_broadcast(&fsh_finished);
  pthread_mutex_unlock(&fsh_alive_lock);
  if (joiner) {
    fsh_rt_wake(joiner);
    fsh_task_release(joiner);
  }
  fsh_task_release(t);
}

static fsh_task *fsh_next_task(int64_t me) {
  fsh_task *t = fsh_pop(&fsh_queues[me]);
  if (!t) t = fsh_pop(&fsh_injected);
  for (int64_t i = 1; !t && i < fsh_workers; i++) t = fsh_pop(&fsh_queues[(me + i) % fsh_workers]);
  if (t) __atomic_fetch_sub(&fsh_queued, 1, __ATOMIC_RELAXED);
  return t;
}

static void *fsh_work(void *arg) {
  fsh_worker = (int64_t)arg;
  // A stopping runtime runs nothing more, however much is queued.
  while (!__atomic_load_n(&fsh_stopping, __ATOMIC_ACQUIRE)) {
    fsh_task *t = fsh_next_task(fsh_worker);
    if (t) {
      fsh_run(t);
      continue;
    }
    pthread_mutex_lock(&fsh_park);
    while (__atomic_load_n(&fsh_queued, __ATOMIC_RELAXED) <= 0 && !fsh_stopping) pthread_cond_wait(&fsh_parked, &fsh_park);
    pthread_mutex_unlock(&fsh_park);
  }
  pthread_mutex_lock(&fsh_park);
  fsh_stopped++;
  pthread_cond_broadcast(&fsh_left);
  pthread_mutex_unlock(&fsh_park);
  return NULL;
}

// A new task for a future's frame, which it takes over: alive, queued, and with one more
// reference for whoever made it.
fsh_task *fsh_rt_spawn(fsh_poll_fn poll, fsh_drop_fn drop, fsh_drop_fn drop_output, void *frame, int64_t frame_size, int64_t output_size) {
  fsh_task *t = fsh_rt_alloc(sizeof(fsh_task) + frame_size + output_size);
  memcpy(t->memory, frame, frame_size);
  t->frame_size = frame_size;
  t->output_size = output_size;
  t->poll = poll;
  t->drop = drop;
  t->drop_output = drop_output;
  t->outcome = 0;
  t->refs = 2;
  t->joiner = NULL;
  t->state = FSH_QUEUED;
  pthread_mutex_lock(&fsh_alive_lock);
  t->prev = NULL;
  t->next = fsh_alive;
  if (fsh_alive) fsh_alive->prev = t;
  fsh_alive = t;
  pthread_mutex_unlock(&fsh_alive_lock);
  fsh_schedule(t);
  return t;
}

// Awaits a spawned task: when it is done, its poll result is copied to out, which then owns
// it, and its outcome given; until then the awaiting task is woken when it finishes.
int32_t fsh_rt_join(fsh_task *t, fsh_task *waiter, void *out) {
  pthread_mutex_lock(&fsh_alive_lock);
  if (__atomic_load_n(&t->state, __ATOMIC_ACQUIRE) == FSH_DONE) {
    pthread_mutex_unlock(&fsh_alive_lock);
    int32_t outcome = t->outcome;
    memcpy(out, fsh_output(t), t->output_size);
    t->outcome = 0;
    return outcome;
  }
  if (t->joiner != waiter) {
    __atomic_fetch_add(&waiter->refs, 1, __ATOMIC_RELAXED);
    t->joiner = waiter;
  }
  pthread_mutex_unlock(&fsh_alive_lock);
  return 0;
}

// Timers: a heap of deadlines, earliest first, and a thread that wakes each task when its
// deadline passes. Each entry holds a reference to its task.
// A timer wakes a sleeping task, or with a signal, aborts it for 'AbortSignal.timeout'.
typedef struct { int64_t deadline; fsh_task *task; struct fsh_signal *signal; } fsh_timer;
void fsh_rt_signal_abort(struct fsh_signal *s);
void fsh_rt_signal_release(struct fsh_signal *s);
static pthread_mutex_t fsh_timer_lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t fsh_timer_changed = PTHREAD_COND_INITIALIZER;
static fsh_timer *fsh_timers = NULL;
static int64_t fsh_timer_count = 0, fsh_timer_capacity = 0;
static int32_t fsh_timers_stopping = 0;
static pthread_t fsh_timer_thread;

static int64_t fsh_now(void) {
  struct timespec now;
  clock_gettime(CLOCK_MONOTONIC, &now);
  return (int64_t)now.tv_sec * 1000000000 + now.tv_nsec;
}

static void fsh_timer_swap(int64_t a, int64_t b) {
  fsh_timer t = fsh_timers[a];
  fsh_timers[a] = fsh_timers[b];
  fsh_timers[b] = t;
}

static void fsh_timer_add(int64_t deadline, fsh_task *task, struct fsh_signal *signal) {
  pthread_mutex_lock(&fsh_timer_lock);
  if (fsh_timer_count == fsh_timer_capacity) {
    fsh_timer_capacity = fsh_timer_capacity ? fsh_timer_capacity * 2 : 64;
    fsh_timers = realloc(fsh_timers, fsh_timer_capacity * sizeof(fsh_timer));
  }
  int64_t at = fsh_timer_count++;
  fsh_timers[at] = (fsh_timer){ deadline, task, signal };
  while (at > 0 && fsh_timers[(at - 1) / 2].deadline > fsh_timers[at].deadline) {
    fsh_timer_swap(at, (at - 1) / 2);
    at = (at - 1) / 2;
  }
  pthread_cond_signal(&fsh_timer_changed);
  pthread_mutex_unlock(&fsh_timer_lock);
}

static fsh_timer fsh_timer_take(void) {
  fsh_timer taken = fsh_timers[0];
  fsh_timers[0] = fsh_timers[--fsh_timer_count];
  for (int64_t at = 0;;) {
    int64_t least = at, left = at * 2 + 1, right = left + 1;
    if (left < fsh_timer_count && fsh_timers[left].deadline < fsh_timers[least].deadline) least = left;
    if (right < fsh_timer_count && fsh_timers[right].deadline < fsh_timers[least].deadline) least = right;
    if (least == at) break;
    fsh_timer_swap(at, least);
    at = least;
  }
  return taken;
}

// An aborted sleep takes its timer off the heap, so it neither waits out its deadline holding the
// task nor wakes it later.
// ponytail: an O(n) search for the entry, a handle kept in the frame if timer heaps grow large
void fsh_rt_sleep_leave(fsh_task *task) {
  pthread_mutex_lock(&fsh_timer_lock);
  int64_t at = 0;
  while (at < fsh_timer_count && (fsh_timers[at].task != task || fsh_timers[at].signal)) at++;
  if (at == fsh_timer_count) return (void)pthread_mutex_unlock(&fsh_timer_lock);
  fsh_timers[at] = fsh_timers[--fsh_timer_count];
  while (at > 0 && fsh_timers[(at - 1) / 2].deadline > fsh_timers[at].deadline) {
    fsh_timer_swap(at, (at - 1) / 2);
    at = (at - 1) / 2;
  }
  for (;;) {
    int64_t least = at, left = at * 2 + 1, right = left + 1;
    if (left < fsh_timer_count && fsh_timers[left].deadline < fsh_timers[least].deadline) least = left;
    if (right < fsh_timer_count && fsh_timers[right].deadline < fsh_timers[least].deadline) least = right;
    if (least == at) break;
    fsh_timer_swap(at, least);
    at = least;
  }
  pthread_mutex_unlock(&fsh_timer_lock);
  fsh_task_release(task);
}

// What a timer does when it fires, or is dropped at shutdown: its count on the task or signal
// is given up either way.
static void fsh_timer_fire(fsh_timer t, int32_t fire) {
  if (t.signal) {
    if (fire) fsh_rt_signal_abort(t.signal);
    fsh_rt_signal_release(t.signal);
    return;
  }
  if (fire) fsh_rt_wake(t.task);
  fsh_task_release(t.task);
}

static void *fsh_timing(void *arg) {
  pthread_mutex_lock(&fsh_timer_lock);
  while (!fsh_timers_stopping) {
    if (fsh_timer_count > 0 && fsh_timers[0].deadline <= fsh_now()) {
      fsh_timer due = fsh_timer_take();
      pthread_mutex_unlock(&fsh_timer_lock);
      fsh_timer_fire(due, 1);
      pthread_mutex_lock(&fsh_timer_lock);
      continue;
    }
    if (fsh_timer_count == 0) {
      pthread_cond_wait(&fsh_timer_changed, &fsh_timer_lock);
      continue;
    }
    // Condition waits take a wall-clock time, so the wait is the monotonic gap from now.
    int64_t gap = fsh_timers[0].deadline - fsh_now();
    struct timespec until;
    clock_gettime(CLOCK_REALTIME, &until);
    int64_t nanos = until.tv_nsec + gap % 1000000000;
    until.tv_sec += gap / 1000000000 + nanos / 1000000000;
    until.tv_nsec = nanos % 1000000000;
    pthread_cond_timedwait(&fsh_timer_changed, &fsh_timer_lock, &until);
  }
  pthread_mutex_unlock(&fsh_timer_lock);
  return arg;
}

// Polls a sleep, whose frame holds its state and first the delay in milliseconds, then its
// deadline: done once the deadline has passed, and until then a timer wakes the task.
int32_t fsh_rt_sleep(int64_t *frame, fsh_task *task) {
  int32_t *state = (int32_t *)frame;
  int64_t *deadline = frame + 1;
  if (*state == 0) {
    *state = 1;
    int64_t ms = *deadline > 0 ? *deadline : 0, now = fsh_now();
    *deadline = ms > (INT64_MAX - now) / 1000000 ? INT64_MAX : now + ms * 1000000;
  } else if (fsh_now() >= *deadline) return 1;
  __atomic_fetch_add(&task->refs, 1, __ATOMIC_RELAXED);
  fsh_timer_add(*deadline, task, NULL);
  return 0;
}

// One printed line is several writes; holding the stream's lock across them keeps lines from
// tasks on other threads whole.
void fsh_rt_print_begin(int32_t stream) {
  flockfile(stream == 2 ? stderr : stdout);
}

void fsh_rt_print_end(int32_t stream) {
  funlockfile(stream == 2 ? stderr : stdout);
}

// A Lock's word: 0 unlocked, or the token of the thread holding it. A lock is held only for a
// synchronous callback, so a waiter spins briefly, then gives its thread up between tries.
// Taking a lock this thread already holds would wait forever, so it is refused: 1, and the
// caller panics.
// ponytail: spin-then-yield, a parking queue if contended locks show up in profiles
static int32_t fsh_me(void) {
  // 0 marks an unlocked word, so a counter wrapping round skips it.
  while (!fsh_token) fsh_token = __atomic_add_fetch(&fsh_tokens, 1, __ATOMIC_RELAXED);
  return fsh_token;
}

int32_t fsh_rt_lock(int32_t *word) {
  int32_t me = fsh_me();
  if (__atomic_load_n(word, __ATOMIC_RELAXED) == me) return 1;
  for (int spins = 0;; spins++) {
    int32_t open = 0;
    if (__atomic_compare_exchange_n(word, &open, me, 1, __ATOMIC_ACQUIRE, __ATOMIC_RELAXED)) return 0;
    if (spins >= 64) sched_yield();
  }
}

void fsh_rt_unlock(int32_t *word) {
  __atomic_store_n(word, 0, __ATOMIC_RELEASE);
}

// A shared value's block: its count, then a Lock's word and the value. Made with one count.
void *fsh_rt_shared_new(int64_t size) {
  int64_t *block = fsh_rt_alloc(size);
  block[0] = 1;
  *(int32_t *)(block + 1) = 0;
  return block;
}

void fsh_rt_shared_retain(int64_t *block) {
  if (block) __atomic_fetch_add(block, 1, __ATOMIC_RELAXED);
}

// Gives up a count: whether it was the last, so the caller drops the value and frees the block.
// A handle moved out of its slot leaves null, which holds no count.
int32_t fsh_rt_shared_release(int64_t *block) {
  return block && __atomic_sub_fetch(block, 1, __ATOMIC_ACQ_REL) == 0;
}

// Tasks waiting on a semaphore or a channel, oldest first, each holding a count on its task.
typedef struct { fsh_task **tasks; int64_t count, capacity; } fsh_waiters;

// A task already waiting stays where it is: a wake it didn't wait for, from a timer or an abort,
// polls it again, and a second place in line would swallow a wake meant for the next task.
static void fsh_wait_on(fsh_waiters *w, fsh_task *t) {
  for (int64_t i = 0; i < w->count; i++) {
    if (w->tasks[i] == t) return;
  }
  if (w->count == w->capacity) {
    int64_t capacity = w->capacity ? w->capacity * 2 : 4;
    fsh_task **tasks = fsh_rt_alloc(capacity * sizeof(fsh_task *));
    if (w->count) memcpy(tasks, w->tasks, w->count * sizeof(fsh_task *));
    fsh_rt_free(w->tasks);
    w->tasks = tasks;
    w->capacity = capacity;
  }
  __atomic_fetch_add(&t->refs, 1, __ATOMIC_RELAXED);
  w->tasks[w->count++] = t;
}

// The oldest waiter, taken off the list, for the caller to wake once its lock is released.
// ponytail: O(n) removal from the front, a ring if waiter lists grow long
static fsh_task *fsh_next_waiter(fsh_waiters *w) {
  if (w->count == 0) return NULL;
  fsh_task *t = w->tasks[0];
  memmove(w->tasks, w->tasks + 1, --w->count * sizeof(fsh_task *));
  return t;
}

static void fsh_wake_waiter(fsh_task *t) {
  if (!t) return;
  fsh_rt_wake(t);
  fsh_task_release(t);
}

// Takes a task off a list it waits on, for the caller to release once its lock is released;
// NULL when it isn't there, as when a wake already took it off.
static fsh_task *fsh_unwait(fsh_waiters *w, fsh_task *t) {
  for (int64_t i = 0; i < w->count; i++) {
    if (w->tasks[i] != t) continue;
    memmove(w->tasks + i, w->tasks + i + 1, (--w->count - i) * sizeof(fsh_task *));
    return t;
  }
  return NULL;
}

static void fsh_waiters_free(fsh_waiters *w) {
  for (int64_t i = 0; i < w->count; i++) fsh_task_release(w->tasks[i]);
  fsh_rt_free(w->tasks);
}

// A semaphore's block: its count, its lock, the slots free, and the tasks waiting for one.
typedef struct { int64_t count; pthread_mutex_t lock; int64_t permits; fsh_waiters waiting; } fsh_semaphore;

fsh_semaphore *fsh_rt_semaphore_new(int64_t permits) {
  fsh_semaphore *s = fsh_rt_alloc(sizeof(fsh_semaphore));
  s->count = 1;
  pthread_mutex_init(&s->lock, NULL);
  s->permits = permits;
  s->waiting = (fsh_waiters){ NULL, 0, 0 };
  return s;
}

// Another count on a semaphore's or a channel's block, both of which start with theirs.
void fsh_rt_block_retain(int64_t *block) {
  if (block) __atomic_fetch_add(block, 1, __ATOMIC_RELAXED);
}

void fsh_rt_semaphore_release(fsh_semaphore *s) {
  if (!s || __atomic_sub_fetch(&s->count, 1, __ATOMIC_ACQ_REL) > 0) return;
  fsh_waiters_free(&s->waiting);
  pthread_mutex_destroy(&s->lock);
  fsh_rt_free(s);
}

int64_t fsh_rt_semaphore_available(fsh_semaphore *s) {
  pthread_mutex_lock(&s->lock);
  int64_t free = s->permits;
  pthread_mutex_unlock(&s->lock);
  return free;
}

// A Permit's block: its own count, so copies the compiler makes share one slot, and its
// semaphore, on which it holds a count.
typedef struct { int64_t count; fsh_semaphore *semaphore; } fsh_permit;

// Polls 'acquire()': takes a slot, giving a new Permit through out, or waits.
int32_t fsh_rt_semaphore_acquire(fsh_semaphore *s, fsh_task *task, fsh_permit **out) {
  pthread_mutex_lock(&s->lock);
  int32_t taken = s->permits > 0;
  if (taken) s->permits--;
  else fsh_wait_on(&s->waiting, task);
  pthread_mutex_unlock(&s->lock);
  if (!taken) return 0;
  fsh_rt_block_retain(&s->count);
  fsh_permit *p = fsh_rt_alloc(sizeof(fsh_permit));
  p->count = 1;
  p->semaphore = s;
  *out = p;
  return 1;
}

// An aborted 'acquire' leaves the waiters. One a release already woke passes that wake on, so
// the slot it would have taken isn't left with nobody coming for it.
void fsh_rt_semaphore_leave(fsh_semaphore *s, fsh_task *task) {
  pthread_mutex_lock(&s->lock);
  fsh_task *mine = fsh_unwait(&s->waiting, task);
  fsh_task *next = !mine && s->permits > 0 ? fsh_next_waiter(&s->waiting) : NULL;
  pthread_mutex_unlock(&s->lock);
  if (mine) fsh_task_release(mine);
  fsh_wake_waiter(next);
}

// Drops a count on a Permit; the last gives its slot back, waking the oldest waiter.
void fsh_rt_permit_drop(fsh_permit *p) {
  if (!p || __atomic_sub_fetch(&p->count, 1, __ATOMIC_ACQ_REL) > 0) return;
  fsh_semaphore *s = p->semaphore;
  fsh_rt_free(p);
  pthread_mutex_lock(&s->lock);
  s->permits++;
  fsh_task *next = fsh_next_waiter(&s->waiting);
  pthread_mutex_unlock(&s->lock);
  fsh_wake_waiter(next);
  fsh_rt_semaphore_release(s);
}

// A channel's block: its count, its lock, a ring of up to capacity values of size bytes each,
// whether it is closed, the function dropping a value it still holds, and the tasks waiting to
// send and to receive.
typedef struct {
  int64_t count;
  pthread_mutex_t lock;
  int64_t capacity, size, head, length;
  int32_t closed;
  char *ring;
  void (*drop)(void *);
  fsh_waiters senders, receivers;
} fsh_channel;

fsh_channel *fsh_rt_channel_new(int64_t capacity, int64_t size, void (*drop)(void *)) {
  fsh_channel *c = fsh_rt_alloc(sizeof(fsh_channel));
  c->count = 1;
  pthread_mutex_init(&c->lock, NULL);
  c->capacity = capacity;
  c->size = size;
  c->head = c->length = 0;
  c->closed = 0;
  c->ring = fsh_rt_alloc(capacity * (size > 0 ? size : 1));
  c->drop = drop;
  c->senders = c->receivers = (fsh_waiters){ NULL, 0, 0 };
  return c;
}

void fsh_rt_channel_release(fsh_channel *c) {
  if (!c || __atomic_sub_fetch(&c->count, 1, __ATOMIC_ACQ_REL) > 0) return;
  for (int64_t i = 0; i < c->length; i++) c->drop(c->ring + (c->head + i) % c->capacity * c->size);
  fsh_rt_free(c->ring);
  fsh_waiters_free(&c->senders);
  fsh_waiters_free(&c->receivers);
  pthread_mutex_destroy(&c->lock);
  fsh_rt_free(c);
}

// Polls 'send(v)': moves the value in, leaving its slot empty, and wakes a receiver; or waits
// while the ring is full. 3 when the channel is closed, for the caller's panic.
int32_t fsh_rt_channel_send(fsh_channel *c, void *value, fsh_task *task) {
  pthread_mutex_lock(&c->lock);
  if (c->closed) {
    pthread_mutex_unlock(&c->lock);
    return 3;
  }
  if (c->length == c->capacity) {
    fsh_wait_on(&c->senders, task);
    pthread_mutex_unlock(&c->lock);
    return 0;
  }
  memcpy(c->ring + (c->head + c->length) % c->capacity * c->size, value, c->size);
  memset(value, 0, c->size);
  c->length++;
  fsh_task *next = fsh_next_waiter(&c->receivers);
  pthread_mutex_unlock(&c->lock);
  fsh_wake_waiter(next);
  return 1;
}

// Polls 'receive()': moves the oldest value out and wakes a sender, gives 2 with nothing once
// the channel is closed and empty, or waits.
int32_t fsh_rt_channel_receive(fsh_channel *c, void *out, fsh_task *task) {
  pthread_mutex_lock(&c->lock);
  if (c->length == 0) {
    int32_t closed = c->closed;
    if (closed) memset(out, 0, c->size);
    else fsh_wait_on(&c->receivers, task);
    pthread_mutex_unlock(&c->lock);
    return closed ? 2 : 0;
  }
  memcpy(out, c->ring + c->head * c->size, c->size);
  c->head = (c->head + 1) % c->capacity;
  c->length--;
  fsh_task *next = fsh_next_waiter(&c->senders);
  pthread_mutex_unlock(&c->lock);
  fsh_wake_waiter(next);
  return 1;
}

// An aborted 'send' or 'receive' leaves the waiters, passing on a wake it already took.
void fsh_rt_channel_leave(fsh_channel *c, fsh_task *task) {
  pthread_mutex_lock(&c->lock);
  fsh_task *mine = fsh_unwait(&c->receivers, task);
  if (!mine) mine = fsh_unwait(&c->senders, task);
  fsh_task *receiver = !mine && c->length > 0 ? fsh_next_waiter(&c->receivers) : NULL;
  fsh_task *sender = !mine && c->length < c->capacity ? fsh_next_waiter(&c->senders) : NULL;
  pthread_mutex_unlock(&c->lock);
  if (mine) fsh_task_release(mine);
  fsh_wake_waiter(receiver);
  fsh_wake_waiter(sender);
}

// Closes a channel: what it holds can still be received, and every task waiting is woken to
// see it closed.
void fsh_rt_channel_close(fsh_channel *c) {
  pthread_mutex_lock(&c->lock);
  c->closed = 1;
  fsh_waiters senders = c->senders, receivers = c->receivers;
  c->senders = c->receivers = (fsh_waiters){ NULL, 0, 0 };
  pthread_mutex_unlock(&c->lock);
  for (int64_t i = 0; i < senders.count; i++) fsh_wake_waiter(senders.tasks[i]);
  for (int64_t i = 0; i < receivers.count; i++) fsh_wake_waiter(receivers.tasks[i]);
  fsh_rt_free(senders.tasks);
  fsh_rt_free(receivers.tasks);
}

// An abort signal's block, shared by its controller and every signal handle: its count, its lock,
// whether it has aborted, and the tasks waiting on it to.
typedef struct fsh_signal { int64_t count; pthread_mutex_t lock; int32_t aborted; fsh_waiters waiting; } fsh_signal;

fsh_signal *fsh_rt_signal_new(void) {
  fsh_signal *s = fsh_rt_alloc(sizeof(fsh_signal));
  s->count = 1;
  pthread_mutex_init(&s->lock, NULL);
  s->aborted = 0;
  s->waiting = (fsh_waiters){ NULL, 0, 0 };
  return s;
}

void fsh_rt_signal_release(fsh_signal *s) {
  if (!s || __atomic_sub_fetch(&s->count, 1, __ATOMIC_ACQ_REL) > 0) return;
  fsh_waiters_free(&s->waiting);
  pthread_mutex_destroy(&s->lock);
  fsh_rt_free(s);
}

int32_t fsh_rt_signal_aborted(fsh_signal *s) {
  return __atomic_load_n(&s->aborted, __ATOMIC_ACQUIRE);
}

// Before a wait given a signal polls: it joins the signal's waiters once, and is told whether
// the signal has aborted.
int32_t fsh_rt_signal_enter(fsh_signal *s, int32_t *waiting, fsh_task *task) {
  pthread_mutex_lock(&s->lock);
  int32_t aborted = s->aborted;
  if (!aborted && !*waiting) {
    fsh_wait_on(&s->waiting, task);
    *waiting = 1;
  }
  pthread_mutex_unlock(&s->lock);
  return aborted;
}

// Once a wait given a signal is over, it leaves the signal's waiters if it is still there.
void fsh_rt_signal_leave(fsh_signal *s, int32_t *waiting, fsh_task *task) {
  if (!*waiting) return;
  *waiting = 0;
  pthread_mutex_lock(&s->lock);
  fsh_task *mine = fsh_unwait(&s->waiting, task);
  pthread_mutex_unlock(&s->lock);
  if (mine) fsh_task_release(mine);
}

// 'AbortSignal.timeout(ms)': a signal the timer thread aborts after ms, holding a count on it
// until then.
fsh_signal *fsh_rt_signal_timeout(int64_t ms) {
  fsh_signal *s = fsh_rt_signal_new();
  s->count = 2;
  int64_t now = fsh_now();
  ms = ms > 0 ? ms : 0;
  fsh_timer_add(ms > (INT64_MAX - now) / 1000000 ? INT64_MAX : now + ms * 1000000, NULL, s);
  return s;
}

// Aborts once, waking every task waiting on the signal to see it.
void fsh_rt_signal_abort(fsh_signal *s) {
  pthread_mutex_lock(&s->lock);
  __atomic_store_n(&s->aborted, 1, __ATOMIC_RELEASE);
  fsh_waiters waiting = s->waiting;
  s->waiting = (fsh_waiters){ NULL, 0, 0 };
  pthread_mutex_unlock(&s->lock);
  for (int64_t i = 0; i < waiting.count; i++) fsh_wake_waiter(waiting.tasks[i]);
  fsh_rt_free(waiting.tasks);
}

// The reactor: a thread waiting on kqueue (macOS) or epoll (Linux) for the sockets tasks wait
// on. Each interest is one task waiting for one socket to be readable or writable, once; the
// list holds a count on each task, so shutdown can give back those never woken.
// ponytail: one list scanned under one lock; keep interests per socket if many connections wait.
typedef struct { int fd; int32_t writing; fsh_task *task; } fsh_interest;
static pthread_mutex_t fsh_io_lock = PTHREAD_MUTEX_INITIALIZER;
static fsh_interest *fsh_interests = NULL;
static int64_t fsh_interest_count = 0, fsh_interest_capacity = 0;
static int fsh_poller = -1;
static int32_t fsh_io_stopping = 0;
static pthread_t fsh_io_thread;
#ifndef __APPLE__
static int fsh_io_wake = -1;
#endif

// Arms the kernel for what is still wanted of a socket: on epoll one registration covers both
// directions, so it is set again from the whole list.
static void fsh_io_arm(int fd, int32_t writing) {
#ifdef __APPLE__
  struct kevent change;
  EV_SET(&change, fd, writing ? EVFILT_WRITE : EVFILT_READ, EV_ADD | EV_ONESHOT, 0, 0, NULL);
  kevent(fsh_poller, &change, 1, NULL, 0, NULL);
#else
  (void)writing;
  uint32_t events = EPOLLONESHOT;
  for (int64_t i = 0; i < fsh_interest_count; i++) {
    if (fsh_interests[i].fd == fd) events |= fsh_interests[i].writing ? EPOLLOUT : EPOLLIN;
  }
  struct epoll_event event = { .events = events, .data.fd = fd };
  if (epoll_ctl(fsh_poller, EPOLL_CTL_MOD, fd, &event) < 0) epoll_ctl(fsh_poller, EPOLL_CTL_ADD, fd, &event);
#endif
}

// A task waits for a socket to be ready. Several may wait on one socket, as tasks sharing a
// cloned listener do, and each is woken.
static void fsh_io_wait(int fd, int32_t writing, fsh_task *task) {
  pthread_mutex_lock(&fsh_io_lock);
  int64_t at = 0;
  while (at < fsh_interest_count && (fsh_interests[at].fd != fd || fsh_interests[at].writing != writing || fsh_interests[at].task != task)) at++;
  if (at == fsh_interest_count) {
    if (fsh_interest_count == fsh_interest_capacity) {
      fsh_interest_capacity = fsh_interest_capacity ? fsh_interest_capacity * 2 : 16;
      fsh_interests = realloc(fsh_interests, fsh_interest_capacity * sizeof(fsh_interest));
    }
    __atomic_fetch_add(&task->refs, 1, __ATOMIC_RELAXED);
    fsh_interests[fsh_interest_count++] = (fsh_interest){ fd, writing, task };
  }
  fsh_io_arm(fd, writing);
  pthread_mutex_unlock(&fsh_io_lock);
}

// Takes out the interests in a socket that are ready, or all of them when it is closing, and
// wakes their tasks outside the lock. On epoll, what is still wanted of it is armed again.
static void fsh_io_take(int fd, int32_t readable, int32_t writable, int32_t closing) {
  pthread_mutex_lock(&fsh_io_lock);
  fsh_task **woken = NULL;
  int64_t count = 0;
  for (int64_t i = 0; i < fsh_interest_count;) {
    fsh_interest *in = &fsh_interests[i];
    if (in->fd != fd || !(closing || (in->writing ? writable : readable))) { i++; continue; }
    woken = realloc(woken, (count + 1) * sizeof *woken);
    woken[count++] = in->task;
    fsh_interests[i] = fsh_interests[--fsh_interest_count];
  }
#ifndef __APPLE__
  for (int64_t i = 0; !closing && i < fsh_interest_count; i++) {
    if (fsh_interests[i].fd == fd) {
      fsh_io_arm(fd, fsh_interests[i].writing);
      break;
    }
  }
#endif
  pthread_mutex_unlock(&fsh_io_lock);
  for (int64_t i = 0; i < count; i++) fsh_wake_waiter(woken[i]);
  free(woken);
}

// A socket is closing: those waiting on it are woken, to find it gone.
static void fsh_io_forget(int fd) { fsh_io_take(fd, 0, 0, 1); }

// Wakes the tasks waiting on what the kernel says is ready.
static void fsh_io_ready(int fd, int32_t readable, int32_t writable) { fsh_io_take(fd, readable, writable, 0); }

static void *fsh_io_loop(void *arg) {
  for (;;) {
#ifdef __APPLE__
    struct kevent events[64];
    int n = kevent(fsh_poller, NULL, 0, events, 64, NULL);
    for (int i = 0; i < n; i++) {
      if (events[i].filter == EVFILT_USER) continue;
      int fd = (int)events[i].ident;
      int32_t error = (events[i].flags & (EV_EOF | EV_ERROR)) != 0;
      fsh_io_ready(fd, events[i].filter == EVFILT_READ || error, events[i].filter == EVFILT_WRITE || error);
    }
#else
    struct epoll_event events[64];
    int n = epoll_wait(fsh_poller, events, 64, -1);
    for (int i = 0; i < n; i++) {
      if (events[i].data.fd == fsh_io_wake) continue;
      int32_t error = (events[i].events & (EPOLLERR | EPOLLHUP)) != 0;
      fsh_io_ready(events[i].data.fd, (events[i].events & EPOLLIN) || error, (events[i].events & EPOLLOUT) || error);
    }
#endif
    if (__atomic_load_n(&fsh_io_stopping, __ATOMIC_ACQUIRE)) return arg;
  }
}

static void fsh_io_start(void) {
#ifdef __APPLE__
  fsh_poller = kqueue();
  struct kevent wake;
  EV_SET(&wake, 0, EVFILT_USER, EV_ADD | EV_CLEAR, 0, 0, NULL);
  kevent(fsh_poller, &wake, 1, NULL, 0, NULL);
#else
  fsh_poller = epoll_create1(EPOLL_CLOEXEC);
  fsh_io_wake = eventfd(0, EFD_NONBLOCK | EFD_CLOEXEC);
  struct epoll_event event = { .events = EPOLLIN, .data.fd = fsh_io_wake };
  epoll_ctl(fsh_poller, EPOLL_CTL_ADD, fsh_io_wake, &event);
#endif
  pthread_create(&fsh_io_thread, NULL, fsh_io_loop, NULL);
}

// Stops the reactor and gives back the counts its interests hold on tasks never woken.
static void fsh_io_stop(void) {
  __atomic_store_n(&fsh_io_stopping, 1, __ATOMIC_RELEASE);
#ifdef __APPLE__
  struct kevent wake;
  EV_SET(&wake, 0, EVFILT_USER, 0, NOTE_TRIGGER, 0, NULL);
  kevent(fsh_poller, &wake, 1, NULL, 0, NULL);
#else
  uint64_t one = 1;
  (void)!write(fsh_io_wake, &one, sizeof one);
#endif
  pthread_join(fsh_io_thread, NULL);
  // Taken out under the lock first: a release may drop a socket, which looks through the list.
  pthread_mutex_lock(&fsh_io_lock);
  fsh_interest *left = fsh_interests;
  int64_t count = fsh_interest_count;
  fsh_interests = NULL;
  fsh_interest_count = fsh_interest_capacity = 0;
  pthread_mutex_unlock(&fsh_io_lock);
  for (int64_t i = 0; i < count; i++) fsh_task_release(left[i].task);
  free(left);
  close(fsh_poller);
  fsh_poller = -1;
#ifndef __APPLE__
  close(fsh_io_wake);
#endif
}

// A socket's block: its count and its file descriptor, closed with the last count.
typedef struct { int64_t count; int fd; } fsh_socket;

static fsh_socket *fsh_socket_new(int fd) {
  fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK);
  // A program the Fish program starts doesn't inherit its sockets.
  fcntl(fd, F_SETFD, FD_CLOEXEC);
#ifdef __APPLE__
  int on = 1;
  setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, sizeof on);
#endif
  fsh_socket *s = fsh_rt_alloc(sizeof(fsh_socket));
  s->count = 1;
  s->fd = fd;
  return s;
}

void fsh_rt_socket_release(fsh_socket *s) {
  if (!s || __atomic_sub_fetch(&s->count, 1, __ATOMIC_ACQ_REL) > 0) return;
  if (fsh_poller >= 0) fsh_io_forget(s->fd);
  close(s->fd);
  fsh_rt_free(s);
}

// A failed call's IoError message: what was being done, and the system's reason.
static int32_t fsh_io_failed(fsh_str **message, const char *doing) {
  // strerror's text may be shared between threads, so it is copied under a lock.
  static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
  int error = errno;
  char text[256];
  pthread_mutex_lock(&lock);
  snprintf(text, sizeof text, "%s: %s", doing, strerror(error));
  pthread_mutex_unlock(&lock);
  *message = fsh_rt_str_from_cstring(text);
  return 5;
}

// An IPv4 address and port from a string and a number, or 0 with the message saying why not.
static int fsh_address(fsh_str *host, int64_t port, struct sockaddr_in *at, fsh_str **message) {
  char *text = fsh_rt_str_cstring(host);
  memset(at, 0, sizeof *at);
  at->sin_family = AF_INET;
  at->sin_port = htons((uint16_t)port);
  char reason[320];
  reason[0] = 0;
  if (port < 0 || port > 65535) snprintf(reason, sizeof reason, "port %lld is outside 0 to 65535", (long long)port);
  else if (!text || inet_pton(AF_INET, text, &at->sin_addr) != 1) {
    snprintf(reason, sizeof reason, "'%.200s' is not an IPv4 address like 127.0.0.1; host names aren't looked up", text ? text : "");
  }
  fsh_rt_free(text);
  if (reason[0]) *message = fsh_rt_str_from_cstring(reason);
  return !reason[0];
}

// 'TcpListener.bind(host, port)': listening at once, or 5 with the reason.
int32_t fsh_rt_tcp_bind(fsh_str *host, int64_t port, fsh_socket **out, fsh_str **message) {
  struct sockaddr_in at;
  if (!fsh_address(host, port, &at, message)) return 5;
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) return fsh_io_failed(message, "can't make a socket");
  int on = 1;
  setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, sizeof on);
  if (bind(fd, (struct sockaddr *)&at, sizeof at) < 0 || listen(fd, 128) < 0) {
    int32_t failed = fsh_io_failed(message, "can't listen there");
    close(fd);
    return failed;
  }
  *out = fsh_socket_new(fd);
  return 1;
}

int64_t fsh_rt_tcp_port(fsh_socket *s) {
  struct sockaddr_in at;
  socklen_t size = sizeof at;
  if (getsockname(s->fd, (struct sockaddr *)&at, &size) < 0) return -1;
  return ntohs(at.sin_port);
}

// Polls 'accept()': a new connection, a wait for one, or 5 with the reason.
// A client that gave up before it was accepted is skipped, as servers expect.
int32_t fsh_rt_tcp_accept(fsh_socket *listener, fsh_task *task, fsh_socket **out, fsh_str **message) {
  int fd;
  while ((fd = accept(listener->fd, NULL, NULL)) < 0 && (errno == EINTR || errno == ECONNABORTED || errno == EPROTO)) {}
  if (fd >= 0) {
    *out = fsh_socket_new(fd);
    return 1;
  }
  if (errno == EAGAIN || errno == EWOULDBLOCK) {
    fsh_io_wait(listener->fd, 0, task);
    return 0;
  }
  return fsh_io_failed(message, "can't accept a connection");
}

// A task's wait on a socket was aborted: it is no longer woken when the socket is ready. A
// connect aborted before its first poll has no socket yet.
void fsh_rt_socket_leave(fsh_socket *s, fsh_task *task) {
  if (!s) return;
  pthread_mutex_lock(&fsh_io_lock);
  fsh_task **left = NULL;
  int64_t count = 0;
  for (int64_t i = 0; i < fsh_interest_count;) {
    if (fsh_interests[i].fd != s->fd || fsh_interests[i].task != task) { i++; continue; }
    left = realloc(left, (count + 1) * sizeof *left);
    left[count++] = task;
    fsh_interests[i] = fsh_interests[--fsh_interest_count];
  }
  pthread_mutex_unlock(&fsh_io_lock);
  for (int64_t i = 0; i < count; i++) fsh_task_release(left[i]);
  free(left);
}

// Polls 'read(max)': up to max bytes, none at the end of the stream, a wait, or 5 with the reason.
int32_t fsh_rt_tcp_read(fsh_socket *s, int64_t max, fsh_task *task, fsh_array *out, fsh_str **message) {
  if (max < 1) {
    char text[96];
    snprintf(text, sizeof text, "'read' needs room for at least 1 byte, not %lld", (long long)max);
    *message = fsh_rt_str_from_cstring(text);
    return 5;
  }
  // Received onto the stack, so the array holds just what came, however much room was asked for.
  char buffer[65536];
  ssize_t n = recv(s->fd, buffer, (size_t)(max < (int64_t)sizeof buffer ? max : (int64_t)sizeof buffer), 0);
  if (n > 0) {
    char *data = fsh_rt_alloc(n);
    memcpy(data, buffer, n);
    *out = (fsh_array){data, n, n};
    return 1;
  }
  if (n == 0) {
    *out = (fsh_array){NULL, 0, 0};
    return 1;
  }
  if (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR) {
    fsh_io_wait(s->fd, 0, task);
    return 0;
  }
  return fsh_io_failed(message, "can't read");
}

// Polls 'write(bytes)': sends what is left past *written, waiting while the socket is full.
int32_t fsh_rt_tcp_write(fsh_socket *s, fsh_array *bytes, int64_t *written, fsh_task *task, fsh_str **message) {
  while (*written < bytes->length) {
#ifdef MSG_NOSIGNAL
    ssize_t n = send(s->fd, bytes->data + *written, (size_t)(bytes->length - *written), MSG_NOSIGNAL);
#else
    ssize_t n = send(s->fd, bytes->data + *written, (size_t)(bytes->length - *written), 0);
#endif
    if (n >= 0) {
      *written += n;
      continue;
    }
    if (errno == EINTR) continue;
    if (errno == EAGAIN || errno == EWOULDBLOCK) {
      fsh_io_wait(s->fd, 1, task);
      return 0;
    }
    return fsh_io_failed(message, "can't write");
  }
  return 1;
}

// Polls 'TcpStream.connect(host, port)': the frame keeps the socket while it connects; once
// writable, the connection either stands, moving the socket out, or failed.
int32_t fsh_rt_tcp_connect(fsh_socket **socket_at, fsh_str *host, int64_t port, fsh_task *task, fsh_socket **out, fsh_str **message) {
  fsh_socket *s = *socket_at;
  if (!s) {
    struct sockaddr_in at;
    if (!fsh_address(host, port, &at, message)) return 5;
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return fsh_io_failed(message, "can't make a socket");
    s = *socket_at = fsh_socket_new(fd);
    // Interrupted, it goes on connecting all the same.
    if (connect(fd, (struct sockaddr *)&at, sizeof at) < 0 && errno != EINPROGRESS && errno != EINTR) return fsh_io_failed(message, "can't connect");
  }
  int error = 0;
  socklen_t size = sizeof error;
  getsockopt(s->fd, SOL_SOCKET, SO_ERROR, &error, &size);
  if (error) {
    errno = error;
    return fsh_io_failed(message, "can't connect");
  }
  struct sockaddr_in peer;
  socklen_t peer_size = sizeof peer;
  if (getpeername(s->fd, (struct sockaddr *)&peer, &peer_size) < 0) {
    if (errno != ENOTCONN) return fsh_io_failed(message, "can't connect");
    fsh_io_wait(s->fd, 1, task);
    return 0;
  }
  *out = s;
  *socket_at = NULL;
  return 1;
}

// Another reference to a JoinHandle's task, where the compiler copies one it then drops.
void fsh_rt_handle_retain(fsh_task *t) {
  if (t) __atomic_fetch_add(&t->refs, 1, __ATOMIC_RELAXED);
}

// Drops a JoinHandle: its task runs on, detached, until it is done or the runtime stops.
void fsh_rt_handle_drop(fsh_task *t) {
  if (t) fsh_task_release(t);
}

// Runs an async main: starts the workers, runs main as the first task until it is done or a
// task panics, stops them, drops every task still alive, and gives main's outcome, its poll
// result copied to out.
int32_t fsh_rt_run(fsh_poll_fn poll, fsh_drop_fn drop, fsh_drop_fn drop_output, void *frame, int64_t frame_size, int64_t output_size, void *out) {
  long cores = sysconf(_SC_NPROCESSORS_ONLN);
  fsh_workers = cores > 0 ? cores : 1;
  fsh_queues = calloc(fsh_workers, sizeof(fsh_queue));
  fsh_threads = calloc(fsh_workers, sizeof(pthread_t));
  for (int64_t i = 0; i < fsh_workers; i++) pthread_mutex_init(&fsh_queues[i].lock, NULL);
  fsh_main_task = fsh_rt_spawn(poll, drop, drop_output, frame, frame_size, output_size);
  // The reactor is ready before any task can wait on a socket.
  fsh_io_start();
  // Workers get the main thread's 8 MiB stack, not the smaller default for other threads, since
  // an async main's calls run on them.
  pthread_attr_t attr;
  pthread_attr_init(&attr);
  pthread_attr_setstacksize(&attr, 8 << 20);
  for (int64_t i = 0; i < fsh_workers; i++) pthread_create(&fsh_threads[i], &attr, fsh_work, (void *)i);
  pthread_attr_destroy(&attr);
  pthread_create(&fsh_timer_thread, NULL, fsh_timing, NULL);
  pthread_mutex_lock(&fsh_alive_lock);
  while (__atomic_load_n(&fsh_main_task->state, __ATOMIC_ACQUIRE) != FSH_DONE && !fsh_panicked) pthread_cond_wait(&fsh_finished, &fsh_alive_lock);
  pthread_mutex_unlock(&fsh_alive_lock);
  pthread_mutex_lock(&fsh_park);
  __atomic_store_n(&fsh_stopping, 1, __ATOMIC_RELEASE);
  pthread_cond_broadcast(&fsh_parked);
  // A worker stops between polls, so one inside a long poll with no await can't be waited for:
  // past a grace period, its task and every other is abandoned rather than dropped.
  struct timespec until;
  clock_gettime(CLOCK_REALTIME, &until);
  until.tv_nsec += 100000000;
  until.tv_sec += until.tv_nsec / 1000000000;
  until.tv_nsec %= 1000000000;
  while (fsh_stopped < fsh_workers && pthread_cond_timedwait(&fsh_left, &fsh_park, &until) == 0) {}
  int stuck = fsh_stopped < fsh_workers;
  pthread_mutex_unlock(&fsh_park);
  if (stuck) {
    fsh_abandoned = 1;
    if (fsh_panicked) exit(101);
    memcpy(out, fsh_output(fsh_main_task), output_size);
    return fsh_main_task->outcome;
  }
  for (int64_t i = 0; i < fsh_workers; i++) pthread_join(fsh_threads[i], NULL);
  pthread_mutex_lock(&fsh_timer_lock);
  fsh_timers_stopping = 1;
  pthread_cond_signal(&fsh_timer_changed);
  pthread_mutex_unlock(&fsh_timer_lock);
  pthread_join(fsh_timer_thread, NULL);
  fsh_io_stop();
  while (fsh_timer_count > 0) fsh_timer_fire(fsh_timer_take(), 0);
  free(fsh_timers);
  // Every task not done is dropped where it stopped; one dropping may release another.
  for (;;) {
    pthread_mutex_lock(&fsh_alive_lock);
    fsh_task *t = fsh_alive;
    if (t) {
      fsh_unlink(t);
      __atomic_store_n(&t->state, FSH_DONE, __ATOMIC_RELEASE);
    }
    pthread_mutex_unlock(&fsh_alive_lock);
    if (!t) break;
    t->drop(t->memory);
    if (t->joiner) fsh_task_release(t->joiner);
    t->joiner = NULL;
    fsh_task_release(t);
  }
  for (int64_t i = 0; i < fsh_workers; i++) free(fsh_queues[i].ring);
  free(fsh_injected.ring);
  free(fsh_queues);
  free(fsh_threads);
  if (fsh_panicked) {
    fsh_task_release(fsh_main_task);
    exit(101);
  }
  int32_t outcome = fsh_main_task->outcome;
  memcpy(out, fsh_output(fsh_main_task), output_size);
  fsh_main_task->outcome = 0;
  fsh_task_release(fsh_main_task);
  return outcome;
}

// Regexes: programs compiled while compiling (src/regex.ts), run over a string's UTF-16 code
// units. A pattern without backreferences or lookaround runs on a Pike VM, linear in the input;
// one with them on a backtracking VM over the same program.

enum { RX_MATCH, RX_CHAR, RX_ANY, RX_ANY_ALL, RX_SET, RX_SPLIT, RX_JUMP, RX_SAVE, RX_ASSERT, RX_RESET, RX_MARK, RX_CHECK, RX_BACKREF, RX_LOOK, RX_LOOK_END };
#define RX_BACKWARD 32
#define RX_HEADER 4

typedef struct {
  const int32_t *code;
  const uint16_t *in;
  int64_t n;
  int unicode;
  int32_t slots;
} fsh_rx;

static int fsh_rx_line(uint32_t c) { return c == '\n' || c == '\r' || c == 0x2028 || c == 0x2029; }

// The character at pos, and its width in units: a surrogate pair is one under 'u'.
static uint32_t fsh_rx_at(const fsh_rx *r, int64_t pos, int64_t *width) {
  uint32_t c = r->in[pos];
  *width = 1;
  if (r->unicode && c >= 0xD800 && c <= 0xDBFF && pos + 1 < r->n && r->in[pos + 1] >= 0xDC00 && r->in[pos + 1] <= 0xDFFF) {
    *width = 2;
    return 0x10000 + ((c - 0xD800) << 10) + (r->in[pos + 1] - 0xDC00);
  }
  return c;
}

// The character ending at pos, read backwards inside a lookbehind.
static uint32_t fsh_rx_before(const fsh_rx *r, int64_t pos, int64_t *width) {
  uint32_t c = r->in[pos - 1];
  *width = 1;
  if (r->unicode && c >= 0xDC00 && c <= 0xDFFF && pos >= 2 && r->in[pos - 2] >= 0xD800 && r->in[pos - 2] <= 0xDBFF) {
    *width = 2;
    return 0x10000 + ((r->in[pos - 2] - 0xD800) << 10) + (c - 0xDC00);
  }
  return c;
}

static int fsh_rx_in_set(const int32_t *ranges, int32_t count, uint32_t c) {
  int32_t lo = 0, hi = count - 1;
  while (lo <= hi) {
    int32_t mid = (lo + hi) / 2;
    if (c < (uint32_t)ranges[mid * 2]) hi = mid - 1;
    else if (c > (uint32_t)ranges[mid * 2 + 1]) lo = mid + 1;
    else return 1;
  }
  return 0;
}

static int fsh_rx_word(const fsh_rx *r, int64_t pos, int folds) {
  if (pos < 0 || pos >= r->n) return 0;
  uint32_t c = r->in[pos];
  return (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_' || (folds && (c == 0x17F || c == 0x212A));
}

static int fsh_rx_assert(const fsh_rx *r, const int32_t *op, int64_t pos) {
  switch (op[1]) {
    case 0: return pos == 0 || (op[2] && fsh_rx_line(r->in[pos - 1]));
    case 1: return pos == r->n || (op[2] && fsh_rx_line(r->in[pos]));
    case 2: return fsh_rx_word(r, pos - 1, op[3]) != fsh_rx_word(r, pos, op[3]);
    default: return fsh_rx_word(r, pos - 1, op[3]) == fsh_rx_word(r, pos, op[3]);
  }
}

// How many words an instruction takes.
static int32_t fsh_rx_size(const int32_t *op) {
  switch (op[0] & ~RX_BACKWARD) {
    case RX_MATCH: case RX_ANY: case RX_ANY_ALL: case RX_LOOK_END: return 1;
    case RX_CHAR: case RX_JUMP: case RX_SAVE: case RX_MARK: case RX_CHECK: return 2;
    case RX_SPLIT: case RX_RESET: case RX_LOOK: return 3;
    case RX_ASSERT: return 4;
    case RX_SET: return 2 + op[1] * 2;
    default: return 3 + op[2];
  }
}

// Whether a one-character instruction takes c.
static int fsh_rx_takes(const int32_t *op, uint32_t c) {
  switch (op[0] & ~RX_BACKWARD) {
    case RX_CHAR: return c == (uint32_t)op[1];
    case RX_ANY: return !fsh_rx_line(c);
    case RX_ANY_ALL: return 1;
    default: return fsh_rx_in_set(op + 2, op[1], c);
  }
}

// The Pike VM: every thread steps over a character together, in priority order, so the first
// to match beats those after it, as a backtracking matcher would find it first.
typedef struct {
  int32_t count;
  int32_t *pcs;
  int64_t *slots;
  int64_t stamp;
} fsh_rx_list;

// Follows the steps that take no character from pc, in priority order, putting each thread that
// reaches one that does on the list. A slot a step sets is put back once what follows it is
// explored, by a frame below it on the work stack, so nothing recurses on the C stack.
typedef struct {
  int32_t pc;
  int32_t slot;
  int64_t old;
} fsh_rx_work;

static void fsh_rx_add(fsh_rx *r, fsh_rx_list *l, int64_t *marks, int32_t start, int64_t pos, int64_t *slots, fsh_rx_work *work) {
  int64_t top = 0;
  work[top++] = (fsh_rx_work){start, -1, 0};
  while (top > 0) {
    fsh_rx_work w = work[--top];
    if (w.slot >= 0) {
      slots[w.slot] = w.old;
      continue;
    }
    int32_t pc = w.pc;
    if (marks[pc] == l->stamp) continue;
    marks[pc] = l->stamp;
    const int32_t *op = r->code + pc;
    switch (op[0]) {
      case RX_JUMP:
        work[top++] = (fsh_rx_work){op[1], -1, 0};
        break;
      case RX_SPLIT:
        work[top++] = (fsh_rx_work){op[2], -1, 0};
        work[top++] = (fsh_rx_work){op[1], -1, 0};
        break;
      case RX_SAVE:
      case RX_MARK: {
        int32_t k = op[0] == RX_SAVE ? op[1] : r->code[0] * 2 + op[1];
        work[top++] = (fsh_rx_work){0, k, slots[k]};
        slots[k] = pos;
        work[top++] = (fsh_rx_work){pc + 2, -1, 0};
        break;
      }
      case RX_CHECK:
        if (slots[r->code[0] * 2 + op[1]] != pos) work[top++] = (fsh_rx_work){pc + 2, -1, 0};
        break;
      case RX_RESET:
        for (int32_t k = op[1] * 2; k < op[2] * 2; k++) {
          work[top++] = (fsh_rx_work){0, k, slots[k]};
          slots[k] = -1;
        }
        work[top++] = (fsh_rx_work){pc + 3, -1, 0};
        break;
      case RX_ASSERT:
        if (fsh_rx_assert(r, op, pos)) work[top++] = (fsh_rx_work){pc + 4, -1, 0};
        break;
      default:
        l->pcs[l->count] = pc;
        memcpy(l->slots + (int64_t)l->count * r->slots, slots, r->slots * sizeof(int64_t));
        l->count++;
    }
  }
}

// From the index from, or only at it when anchored, as a sticky regex is.
static int fsh_rx_pike(fsh_rx *r, int64_t from, int anchored, int64_t *out) {
  // Each instruction is at most one thread in a list, and is followed at most once per list,
  // so the work stack holds at most what every instruction pushes.
  int32_t size = r->code[3];
  int64_t room = 1;
  for (int32_t pc = RX_HEADER; pc < size; pc += fsh_rx_size(r->code + pc)) {
    const int32_t *op = r->code + pc;
    room += op[0] == RX_RESET ? (op[2] - op[1]) * 2 + 1 : 2;
  }
  fsh_rx_work *work = fsh_rt_alloc(room * sizeof(fsh_rx_work));
  int64_t *marks = fsh_rt_alloc(size * sizeof(int64_t));
  for (int32_t k = 0; k < size; k++) marks[k] = -1;
  fsh_rx_list lists[2];
  for (int k = 0; k < 2; k++) {
    lists[k].count = 0;
    lists[k].pcs = fsh_rt_alloc(size * sizeof(int32_t));
    lists[k].slots = fsh_rt_alloc((int64_t)size * r->slots * sizeof(int64_t));
  }
  int64_t *start = fsh_rt_alloc(r->slots * sizeof(int64_t));
  int sticky = anchored, matched = 0;
  int64_t stamp = 0;
  fsh_rx_list *now = &lists[0], *next = &lists[1];
  now->stamp = stamp++;
  for (int64_t pos = from;;) {
    if (!matched && (pos == from || !sticky)) {
      for (int32_t k = 0; k < r->slots; k++) start[k] = -1;
      fsh_rx_add(r, now, marks, RX_HEADER, pos, start, work);
    }
    if (now->count == 0 && (matched || sticky || pos >= r->n)) break;
    int64_t width = 1;
    uint32_t c = pos < r->n ? fsh_rx_at(r, pos, &width) : 0;
    next->count = 0;
    next->stamp = stamp++;
    for (int32_t t = 0; t < now->count; t++) {
      int32_t pc = now->pcs[t];
      int64_t *slots = now->slots + (int64_t)t * r->slots;
      const int32_t *op = r->code + pc;
      if (op[0] == RX_MATCH) {
        matched = 1;
        memcpy(out, slots, r->code[0] * 2 * sizeof(int64_t));
        break;
      }
      if (pos < r->n && fsh_rx_takes(op, c)) fsh_rx_add(r, next, marks, pc + fsh_rx_size(op), pos + width, slots, work);
    }
    fsh_rx_list *swap = now;
    now = next;
    next = swap;
    if (pos >= r->n) break;
    pos += width;
  }
  for (int k = 0; k < 2; k++) {
    fsh_rt_free(lists[k].pcs);
    fsh_rt_free(lists[k].slots);
  }
  fsh_rt_free(start);
  fsh_rt_free(marks);
  fsh_rt_free(work);
  return matched;
}

// The backtracking VM, for backreferences and lookaround: choices and the slots each step
// changed go on one stack, so failing undoes them in order.
// A frame with pc -1 restores slot to pos when popped; any other is a choice to resume.
typedef struct {
  int64_t pc;
  int64_t pos;
  int64_t slot;
} fsh_rx_frame;

typedef struct {
  fsh_rx_frame *at;
  int64_t count, room;
} fsh_rx_stack;

static void fsh_rx_push(fsh_rx_stack *s, int64_t pc, int64_t pos, int64_t slot) {
  if (s->count == s->room) {
    s->room = s->room ? s->room * 2 : 64;
    fsh_rx_frame *grown = fsh_rt_alloc(s->room * sizeof(fsh_rx_frame));
    if (s->at) memcpy(grown, s->at, s->count * sizeof(fsh_rx_frame));
    fsh_rt_free(s->at);
    s->at = grown;
  }
  s->at[s->count++] = (fsh_rx_frame){pc, pos, slot};
}

// What a character folds to, for a backreference that ignores case: its pair in the table the
// program carries, or itself.
static int64_t fsh_rx_fold(const int32_t *table, int64_t c) {
  if (!table) return c;
  int32_t lo = 0, hi = table[0] - 1;
  while (lo <= hi) {
    int32_t mid = (lo + hi) / 2;
    if (c < table[1 + mid * 2]) hi = mid - 1;
    else if (c > table[1 + mid * 2]) lo = mid + 1;
    else return table[2 + mid * 2];
  }
  return c;
}

// Runs from pc at pos until a MATCH or LOOK_END, which gives 1, or until every choice made
// since floor fails, which gives 0 with the slots as they were.
static int fsh_rx_run(fsh_rx *r, fsh_rx_stack *s, int64_t *slots, int64_t pc, int64_t pos, int64_t *end) {
  int64_t floor = s->count;
  const int32_t *table = r->code[2] & 8 ? r->code + r->code[3] : NULL;
  for (;;) {
    const int32_t *op = r->code + pc;
    int back = op[0] & RX_BACKWARD;
    int fails = 0;
    switch (op[0] & ~RX_BACKWARD) {
      case RX_MATCH:
      case RX_LOOK_END:
        *end = pos;
        return 1;
      case RX_CHAR: case RX_ANY: case RX_ANY_ALL: case RX_SET: {
        int64_t width;
        if (back ? pos <= 0 : pos >= r->n) fails = 1;
        else {
          uint32_t c = back ? fsh_rx_before(r, pos, &width) : fsh_rx_at(r, pos, &width);
          if (fsh_rx_takes(op, c)) {
            pos += back ? -width : width;
            pc += fsh_rx_size(op);
          } else fails = 1;
        }
        break;
      }
      case RX_JUMP:
        pc = op[1];
        break;
      case RX_SPLIT:
        fsh_rx_push(s, op[2], pos, 0);
        pc = op[1];
        break;
      case RX_SAVE:
      case RX_MARK: {
        int32_t k = (op[0] & ~RX_BACKWARD) == RX_SAVE ? op[1] : r->code[0] * 2 + op[1];
        fsh_rx_push(s, -1, slots[k], k);
        slots[k] = pos;
        pc += 2;
        break;
      }
      case RX_CHECK:
        if (slots[r->code[0] * 2 + op[1]] == pos) fails = 1;
        else pc += 2;
        break;
      case RX_RESET:
        for (int32_t k = op[1] * 2; k < op[2] * 2; k++) {
          fsh_rx_push(s, -1, slots[k], k);
          slots[k] = -1;
        }
        pc += 3;
        break;
      case RX_ASSERT:
        if (fsh_rx_assert(r, op, pos)) pc += 4;
        else fails = 1;
        break;
      case RX_BACKREF: {
        // Every group of a name is tried in turn; the one that took part is matched again.
        int64_t from = -1, to = -1;
        for (int32_t g = 0; g < op[2]; g++) {
          if (slots[op[3 + g] * 2] >= 0 && slots[op[3 + g] * 2 + 1] >= 0) {
            from = slots[op[3 + g] * 2];
            to = slots[op[3 + g] * 2 + 1];
          }
        }
        int64_t length = from < 0 ? 0 : to - from;
        if (back ? pos - length < 0 : pos + length > r->n) {
          fails = 1;
          break;
        }
        int64_t at = back ? pos - length : pos;
        // Ignoring case under 'u', characters are compared whole, a surrogate pair as one.
        for (int64_t k = 0; k < length && !fails;) {
          int64_t wa = 1, wb = 1;
          uint32_t a = r->in[from + k], b = r->in[at + k];
          if (op[1] && r->unicode) {
            a = fsh_rx_at(r, from + k, &wa);
            b = fsh_rx_at(r, at + k, &wb);
          }
          if (wa != wb || (a != b && !(op[1] && fsh_rx_fold(table, a) == fsh_rx_fold(table, b)))) fails = 1;
          k += wa;
        }
        if (!fails) {
          pos = back ? pos - length : pos + length;
          pc += fsh_rx_size(op);
        }
        break;
      }
      case RX_LOOK: {
        // A lookaround matches its body where it stands, and keeps no choice from inside it.
        int64_t mark = s->count, ignored;
        int ok = fsh_rx_run(r, s, slots, pc + 3, pos, &ignored);
        if (op[1]) {
          // A negative one undoes what its body set.
          while (s->count > mark) {
            fsh_rx_frame f = s->at[--s->count];
            if (f.pc == -1) slots[f.slot] = f.pos;
          }
          ok = !ok;
        } else if (ok) {
          int64_t kept = mark;
          for (int64_t k = mark; k < s->count; k++) if (s->at[k].pc == -1) s->at[kept++] = s->at[k];
          s->count = kept;
        }
        if (ok) pc = op[2];
        else fails = 1;
        break;
      }
    }
    if (!fails) continue;
    // Undo back to the last choice since floor, and take it; with none, this run fails.
    for (;;) {
      if (s->count == floor) return 0;
      fsh_rx_frame f = s->at[--s->count];
      if (f.pc == -1) slots[f.slot] = f.pos;
      else {
        pc = f.pc;
        pos = f.pos;
        break;
      }
    }
  }
}

static int fsh_rx_backtrack(fsh_rx *r, int64_t from, int anchored, int64_t *out) {
  int64_t *slots = fsh_rt_alloc(r->slots * sizeof(int64_t));
  fsh_rx_stack s = {NULL, 0, 0};
  int matched = 0, sticky = anchored;
  for (int64_t start = from; start <= r->n && !matched; ) {
    for (int32_t k = 0; k < r->slots; k++) slots[k] = -1;
    int64_t end;
    matched = fsh_rx_run(r, &s, slots, RX_HEADER, start, &end);
    s.count = 0;
    if (sticky || start >= r->n) break;
    int64_t width = 1;
    fsh_rx_at(r, start, &width);
    start += width;
  }
  if (matched) memcpy(out, slots, r->code[0] * 2 * sizeof(int64_t));
  fsh_rt_free(s.at);
  fsh_rt_free(slots);
  return matched;
}

// A string's UTF-16 code units, which matching and match positions count in.
static uint16_t *fsh_rx_units(fsh_str *s, int64_t *count) {
  const unsigned char *p = s ? (const unsigned char *)s->bytes : NULL;
  int64_t n = s ? s->length : 0, k = 0;
  uint16_t *out = fsh_rt_alloc((n + 1) * sizeof(uint16_t));
  for (int64_t i = 0; i < n;) {
    uint32_t c = p[i];
    int w = c < 0x80 ? 1 : c < 0xE0 ? 2 : c < 0xF0 ? 3 : 4;
    if (w == 2) c = ((c & 0x1F) << 6) | (p[i + 1] & 0x3F);
    else if (w == 3) c = ((c & 0x0F) << 12) | ((p[i + 1] & 0x3F) << 6) | (p[i + 2] & 0x3F);
    else if (w == 4) c = ((c & 0x07) << 18) | ((p[i + 1] & 0x3F) << 12) | ((p[i + 2] & 0x3F) << 6) | (p[i + 3] & 0x3F);
    i += w;
    if (c >= 0x10000) {
      c -= 0x10000;
      out[k++] = 0xD800 + (c >> 10);
      out[k++] = 0xDC00 + (c & 0x3FF);
    } else out[k++] = c;
  }
  *count = k;
  return out;
}

static void fsh_rx_open(fsh_rx *r, const int32_t *code, fsh_str *s) {
  r->code = code;
  r->unicode = code[2] & 1;
  r->slots = code[0] * 2 + code[1];
  r->in = fsh_rx_units(s, &r->n);
}

static int fsh_rx_find(fsh_rx *r, int64_t from, int anchored, int64_t *out) {
  return r->code[2] & 4 ? fsh_rx_backtrack(r, from, anchored, out) : fsh_rx_pike(r, from, anchored, out);
}

// Matches a regex against s, writing each group's start and end, in code units or -1, to out,
// which holds two words per group, the whole match first.
int fsh_rt_regex_match(const int32_t *code, fsh_str *s, int64_t *out) {
  fsh_rx r;
  fsh_rx_open(&r, code, s);
  int matched = fsh_rx_find(&r, 0, code[2] & 2, out);
  fsh_rt_free((void *)r.in);
  return matched;
}

int fsh_rt_regex_test(const int32_t *code, fsh_str *s) {
  int64_t *out = fsh_rt_alloc(code[0] * 2 * sizeof(int64_t));
  int matched = fsh_rt_regex_match(code, s, out);
  fsh_rt_free(out);
  return matched;
}

// Where the next search goes after an empty match at i: one character on, a surrogate pair
// whole under 'u', as AdvanceStringIndex says.
static int64_t fsh_rx_advance(const fsh_rx *r, int64_t i) {
  if (i >= r->n) return i + 1;
  int64_t width = 1;
  fsh_rx_at(r, i, &width);
  return i + width;
}

// The matches of a regex in one string, the first or with 'g' each in turn, and a string
// built from the text between them and what replaces each.
typedef struct {
  fsh_rx r;
  fsh_str *s;
  int64_t *out;
  int64_t at, last;
  int global, done;
  char *built;
  int64_t length, room;
} fsh_rx_iter;

fsh_rx_iter *fsh_rt_regex_iter(const int32_t *code, fsh_str *s, int32_t global) {
  fsh_rx_iter *it = fsh_rt_alloc(sizeof(fsh_rx_iter));
  fsh_rx_open(&it->r, code, s);
  it->s = s;
  it->out = fsh_rt_alloc(code[0] * 2 * sizeof(int64_t));
  it->at = it->last = 0;
  it->global = global < 0 ? (code[2] & 32) != 0 : global;
  it->done = 0;
  it->built = NULL;
  it->length = it->room = 0;
  return it;
}

int fsh_rt_regex_next(fsh_rx_iter *it) {
  if (it->done || it->at > it->r.n || !fsh_rx_find(&it->r, it->at, it->r.code[2] & 2, it->out)) {
    it->done = 1;
    return 0;
  }
  it->at = it->out[1] == it->out[0] ? fsh_rx_advance(&it->r, it->out[1]) : it->out[1];
  if (!it->global) it->done = 1;
  return 1;
}

int64_t *fsh_rt_regex_slots(fsh_rx_iter *it) { return it->out; }

// The text a group took, or null when it took none.
fsh_str *fsh_rt_regex_capture(fsh_rx_iter *it, int64_t group) {
  int64_t from = it->out[group * 2], to = it->out[group * 2 + 1];
  return from < 0 ? NULL : fsh_rt_str_slice(it->s, from, to, 1);
}

static void fsh_rx_append(fsh_rx_iter *it, const char *bytes, int64_t n) {
  if (it->length + n > it->room) {
    int64_t room = (it->length + n) * 2 + 16;
    char *grown = fsh_rt_alloc(room);
    if (it->built) memcpy(grown, it->built, it->length);
    fsh_rt_free(it->built);
    it->built = grown;
    it->room = room;
  }
  memcpy(it->built + it->length, bytes, n);
  it->length += n;
}

static void fsh_rx_append_str(fsh_rx_iter *it, fsh_str *s) {
  if (s) fsh_rx_append(it, s->bytes, s->length);
}

// The units from..to of the string matched, appended as WTF-8.
static void fsh_rx_append_units(fsh_rx_iter *it, int64_t from, int64_t to) {
  if (from >= to) return;
  fsh_str *part = fsh_rt_str_slice(it->s, from, to, 1);
  fsh_rx_append_str(it, part);
  fsh_rt_str_release(part);
}

// Before a match's replacement goes the text since the last one.
void fsh_rt_regex_put(fsh_rx_iter *it, fsh_str *replacement) {
  fsh_rx_append_units(it, it->last, it->out[0]);
  fsh_rx_append_str(it, replacement);
  it->last = it->out[1];
}

// A group's number for $<name>, from the names the program lists after its instructions.
static int64_t fsh_rx_named(const fsh_rx_iter *it, const unsigned char *name, int64_t n) {
  const int32_t *code = it->r.code;
  if (!(code[2] & 16)) return -1;
  const int32_t *p = code + code[3] + (code[2] & 8 ? 1 + code[code[3]] * 2 : 0);
  int64_t found = -1;
  for (int32_t k = 0, count = *p++; k < count; k++) {
    int32_t group = *p++, length = *p++;
    int same = length == n;
    for (int32_t j = 0; j < length; j++) same = same && p[j] == name[j];
    p += length;
    // Of a name's groups, the one that took part.
    if (same && (found < 0 || it->out[group * 2] >= 0)) found = group;
  }
  return found;
}

// A replacement string's patterns, as String.prototype.replace reads them: $$, $&, the text
// before and after the match,
// $n and $nn for an existing group, and $<name> when the pattern names groups.
void fsh_rt_regex_put_pattern(fsh_rx_iter *it, fsh_str *pattern) {
  fsh_rx_append_units(it, it->last, it->out[0]);
  const unsigned char *p = pattern ? (const unsigned char *)pattern->bytes : NULL;
  int64_t n = pattern ? pattern->length : 0, groups = it->r.code[0] - 1;
  for (int64_t i = 0; i < n; i++) {
    if (p[i] != '$' || i + 1 >= n) {
      fsh_rx_append(it, (const char *)p + i, 1);
      continue;
    }
    unsigned char c = p[i + 1];
    if (c == '$') fsh_rx_append(it, "$", 1), i++;
    else if (c == '&') fsh_rx_append_units(it, it->out[0], it->out[1]), i++;
    else if (c == 0x60) fsh_rx_append_units(it, 0, it->out[0]), i++;
    else if (c == '\'') fsh_rx_append_units(it, it->out[1], it->r.n), i++;
    else if (c >= '0' && c <= '9') {
      int64_t one = c - '0', two = i + 2 < n && p[i + 2] >= '0' && p[i + 2] <= '9' ? one * 10 + (p[i + 2] - '0') : -1;
      int64_t g = two >= 1 && two <= groups ? two : one >= 1 && one <= groups ? one : -1;
      if (g < 0) {
        fsh_rx_append(it, "$", 1);
        continue;
      }
      if (it->out[g * 2] >= 0) fsh_rx_append_units(it, it->out[g * 2], it->out[g * 2 + 1]);
      i += g == two ? 2 : 1;
    } else if (c == '<' && (it->r.code[2] & 16)) {
      int64_t close = i + 2;
      while (close < n && p[close] != '>') close++;
      if (close >= n) {
        fsh_rx_append(it, "$", 1);
        continue;
      }
      int64_t g = fsh_rx_named(it, p + i + 2, close - i - 2);
      if (g >= 0 && it->out[g * 2] >= 0) fsh_rx_append_units(it, it->out[g * 2], it->out[g * 2 + 1]);
      i = close;
    } else fsh_rx_append(it, "$", 1);
  }
  it->last = it->out[1];
}

// The string built: what was put, then the rest of the string matched.
fsh_str *fsh_rt_regex_finish(fsh_rx_iter *it) {
  fsh_rx_append_units(it, it->last, it->r.n);
  fsh_str *made = fsh_str_of(it->built ? it->built : "", it->length);
  fsh_rt_free(it->built);
  fsh_rt_free(it->out);
  fsh_rt_free((void *)it->r.in);
  fsh_rt_free(it);
  return made;
}

void fsh_rt_regex_close(fsh_rx_iter *it) {
  fsh_rt_free(it->built);
  fsh_rt_free(it->out);
  fsh_rt_free((void *)it->r.in);
  fsh_rt_free(it);
}

// s.search(re): where the first match starts, or -1.
int64_t fsh_rt_regex_search(const int32_t *code, fsh_str *s) {
  int64_t *out = fsh_rt_alloc(code[0] * 2 * sizeof(int64_t));
  int64_t at = fsh_rt_regex_match(code, s, out) ? out[0] : -1;
  fsh_rt_free(out);
  return at;
}

// Puts a string, or a union of a string and null with those tags, at the end of an array whose
// room the caller made.
static void fsh_rx_list_push(fsh_array *out, fsh_str *part, int32_t tagged, int32_t null_tag, int32_t string_tag) {
  int64_t size = tagged ? 16 : 8;
  if (out->length == out->capacity) {
    int64_t room = out->capacity * 2 + 4;
    char *grown = fsh_rt_array_alloc(room * size);
    if (out->length) memcpy(grown, out->data, out->length * size);
    fsh_rt_free(out->data);
    out->data = grown;
    out->capacity = room;
  }
  char *slot = out->data + out->length * size;
  if (tagged) {
    *(int32_t *)slot = part ? string_tag : null_tag;
    *(fsh_str **)(slot + 8) = part;
  } else *(fsh_str **)slot = part;
  out->length++;
}

// s.split(re, limit), as RegExp.prototype[Symbol.split] does it: the regex tried at each
// position in turn, the text between matches and every group's capture put in order. A
// capture that took no part is null in a tagged array.
void fsh_rt_regex_split(fsh_array *out, const int32_t *code, fsh_str *s, int64_t limit, int32_t tagged, int32_t null_tag, int32_t string_tag) {
  out->data = NULL;
  out->length = out->capacity = 0;
  fsh_rx r;
  fsh_rx_open(&r, code, s);
  int64_t *slots = fsh_rt_alloc(code[0] * 2 * sizeof(int64_t));
  uint64_t lim = (uint64_t)limit & UINT32_MAX;
  if (lim == 0) goto done;
  if (r.n == 0) {
    if (!fsh_rx_find(&r, 0, 1, slots)) fsh_rx_list_push(out, fsh_rt_str_slice(s, 0, 0, 1), tagged, null_tag, string_tag);
    goto done;
  }
  int64_t p = 0, q = 0;
  while (q < r.n) {
    if (!fsh_rx_find(&r, q, 1, slots)) {
      q = fsh_rx_advance(&r, q);
      continue;
    }
    int64_t e = slots[1] < r.n ? slots[1] : r.n;
    if (e == p) {
      q = fsh_rx_advance(&r, q);
      continue;
    }
    fsh_rx_list_push(out, fsh_rt_str_slice(s, p, q, 1), tagged, null_tag, string_tag);
    if ((uint64_t)out->length == lim) goto done;
    for (int32_t g = 1; g < code[0]; g++) {
      fsh_rx_list_push(out, slots[g * 2] < 0 ? NULL : fsh_rt_str_slice(s, slots[g * 2], slots[g * 2 + 1], 1), tagged, null_tag, string_tag);
      if ((uint64_t)out->length == lim) goto done;
    }
    p = q = e;
  }
  fsh_rx_list_push(out, fsh_rt_str_slice(s, p, r.n, 1), tagged, null_tag, string_tag);
done:
  fsh_rt_free(slots);
  fsh_rt_free((void *)r.in);
}

// s.match(re) with 'g': every match's text, or no array when there is none.
int fsh_rt_regex_match_all(fsh_array *out, const int32_t *code, fsh_str *s) {
  out->data = NULL;
  out->length = out->capacity = 0;
  fsh_rx_iter *it = fsh_rt_regex_iter(code, s, 1);
  while (fsh_rt_regex_next(it)) fsh_rx_list_push(out, fsh_rt_regex_capture(it, 0), 0, 0, 0);
  fsh_rt_regex_close(it);
  return out->length > 0;
}
`;
