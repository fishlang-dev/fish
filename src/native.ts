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

__attribute__((destructor)) static void fsh_leaks(void) {
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

// An array's buffer for this many bytes, or none for no elements.
void *fsh_rt_array_alloc(int64_t bytes) {
  return bytes == 0 ? NULL : fsh_rt_alloc(bytes);
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

// A string of a C string's bytes up to its NUL. A byte that doesn't start a UTF-8 sequence, or
// starts one that is cut short, overlong, a surrogate or past U+10FFFF, becomes U+FFFD.
fsh_str *fsh_rt_str_from_cstring(const char *c) {
  const unsigned char *p = (const unsigned char *)c;
  size_t n = strlen(c);
  fsh_str *s = fsh_str_new(n * 3);
  unsigned char *at = (unsigned char *)s->own;
  for (size_t i = 0; i < n;) {
    unsigned char b = p[i];
    int need = b < 0x80 ? 0 : (b & 0xE0) == 0xC0 ? 1 : (b & 0xF0) == 0xE0 ? 2 : (b & 0xF8) == 0xF0 ? 3 : -1;
    uint32_t code = need == 1 ? b & 0x1F : need == 2 ? b & 0x0F : need == 3 ? b & 0x07 : b;
    int ok = need >= 0 && i + need < n;
    for (int k = 1; ok && k <= need; k++) {
      if ((p[i + k] & 0xC0) != 0x80) ok = 0;
      else code = code << 6 | (p[i + k] & 0x3F);
    }
    if (ok && ((need == 1 && code < 0x80) || (need == 2 && (code < 0x800 || (code >= 0xD800 && code <= 0xDFFF))) || (need == 3 && (code < 0x10000 || code > 0x10FFFF)))) ok = 0;
    if (ok) {
      memcpy(at, p + i, need + 1);
      at += need + 1;
      i += need + 1;
    } else {
      *at++ = 0xEF;
      *at++ = 0xBF;
      *at++ = 0xBD;
      i++;
    }
  }
  s->length = at - (unsigned char *)s->own;
  return s;
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

char *fsh_rt_format_f64(double x, char *out) { return fsh_format(x, 0, out); }
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
  __atomic_fetch_add(block, 1, __ATOMIC_RELAXED);
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
`;
