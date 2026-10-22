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

static int64_t fsh_live = 0;

void *fsh_rt_alloc(int64_t size) {
  void *p = malloc(size);
  if (!p) {
    fputs("out of memory\n", stderr);
    exit(101);
  }
  fsh_live++;
  return p;
}

void fsh_rt_free(void *p) {
  if (!p) return;
  fsh_live--;
  free(p);
}

__attribute__((destructor)) static void fsh_leaks(void) {
  const char *check = getenv("FISH_LEAKS");
  if (check && check[0] == '1' && fsh_live != 0) fprintf(stderr, "fish: leaked %lld allocations\n", (long long)fsh_live);
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

void fsh_rt_str_retain(fsh_str *s) {
  if (s && s->count >= 0) s->count++;
}

void fsh_rt_str_release(fsh_str *s) {
  if (!s || s->count < 0 || --s->count > 0) return;
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
    units = units < 0 || parts[i]->units < 0 ? -1 : units + parts[i]->units;
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
  if (s->units >= 0) return s->units;
  int64_t at = 0, n = 0;
  int half = 0;
  while (at < s->length) {
    fsh_next((const unsigned char *)s->bytes, &at, &half);
    n++;
  }
  return s->units = n;
}

// Breadcrumbs: where every 64th UTF-16 unit is, as its character's byte offset times two, plus
// one when the unit is a pair's second half. A literal's are made by the compiler.
#define FSH_STRIDE 64

static void fsh_crumbs(fsh_str *s) {
  int64_t *crumbs = fsh_rt_alloc((s->units / FSH_STRIDE + 1) * sizeof(int64_t));
  int64_t at = 0;
  int half = 0;
  for (int64_t unit = 0; unit < s->units; unit++) {
    if (unit % FSH_STRIDE == 0) crumbs[unit / FSH_STRIDE] = at * 2 + half;
    fsh_next((const unsigned char *)s->bytes, &at, &half);
  }
  s->crumbs = crumbs;
}

// Where UTF-16 unit i is: the byte its character starts at, and whether it is the second half
// of a pair. All-ASCII text is indexed directly; other text walks on from the breadcrumb at
// or before i, at most 63 units.
// ponytail: building breadcrumbs writes to a string that may be shared; once strings cross
// threads this needs an atomic publish.
static int64_t fsh_seek(fsh_str *s, int64_t i, int *half) {
  *half = 0;
  if (fsh_rt_str_units(s) == s->length) return i;
  if (i >= s->units) return s->length;
  int64_t at = 0, unit = 0;
  if (!s->crumbs && s->count >= 0 && s->units > FSH_STRIDE) fsh_crumbs(s);
  if (s->crumbs) {
    int64_t crumb = s->crumbs[i / FSH_STRIDE];
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
void fsh_rt_panic(const char *message) {
  static struct _Unwind_Exception exception;
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
  result->units = s->units >= 0 ? s->units * count : -1;
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

// A NUL-terminated copy of a string's bytes for C, freed with fsh_rt_free.
char *fsh_rt_str_cstring(fsh_str *s) {
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
`;
