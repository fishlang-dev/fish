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
    slice = fsh_rt_alloc(sizeof(fsh_str));
    slice->count = 1;
    slice->length = b - a;
    slice->bytes = s->bytes + a;
    slice->base = s->base ? s->base : s;
    fsh_rt_str_retain(slice->base);
    slice->crumbs = NULL;
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

// An index past the end panics as Rust's does; at is the "panicked at" line.
void fsh_rt_panic_bounds(const char *at, int64_t length, int64_t index) {
  fflush(NULL);
  fprintf(stderr, "%sindex out of bounds: the len is %lld but the index is %llu\n", at, (long long)length, (unsigned long long)index);
  exit(101);
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
`;
