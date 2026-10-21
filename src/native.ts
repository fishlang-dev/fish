// The C half of the runtime, compiled by the same clang call as a program's IR. Its entry
// points are named `fsh_rt_*`.

// Every allocation goes through fsh_rt_alloc and fsh_rt_free, which count what is live. With
// FISH_LEAKS=1 in the environment, a program reports at exit what it never freed.
//
// A string is a block: a reference count, the length in bytes, then the UTF-8 bytes. A count
// below zero marks a literal, which lives for the whole program, so retain and release skip it.

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

typedef struct { int64_t count; int64_t length; char bytes[]; } fsh_str;

void fsh_rt_str_retain(fsh_str *s) {
  if (s && s->count >= 0) s->count++;
}

void fsh_rt_str_release(fsh_str *s) {
  if (s && s->count >= 0 && --s->count == 0) fsh_rt_free(s);
}

static fsh_str *fsh_str_new(int64_t length) {
  fsh_str *s = fsh_rt_alloc(sizeof(fsh_str) + length);
  s->count = 1;
  s->length = length;
  return s;
}

static fsh_str *fsh_str_of(const char *bytes, int64_t length) {
  fsh_str *s = fsh_str_new(length);
  memcpy(s->bytes, bytes, length);
  return s;
}

fsh_str *fsh_rt_str_concat(fsh_str *a, fsh_str *b) {
  fsh_str *s = fsh_str_new(a->length + b->length);
  memcpy(s->bytes, a->bytes, a->length);
  memcpy(s->bytes + a->length, b->bytes, b->length);
  return s;
}

fsh_str *fsh_rt_str_join(fsh_str **parts, int64_t n) {
  int64_t length = 0;
  for (int64_t i = 0; i < n; i++) length += parts[i]->length;
  fsh_str *s = fsh_str_new(length);
  char *at = s->bytes;
  for (int64_t i = 0; i < n; i++) {
    memcpy(at, parts[i]->bytes, parts[i]->length);
    at += parts[i]->length;
  }
  return s;
}

// The first UTF-16 code unit of the character starting at s: the character itself, or the high
// surrogate of one beyond U+FFFF.
static uint32_t fsh_unit(const unsigned char *s) {
  uint32_t c = s[0];
  if (c < 0xE0) return c < 0x80 ? c : (c & 0x1F) << 6 | (s[1] & 0x3F);
  if (c < 0xF0) return (c & 0x0F) << 12 | (s[1] & 0x3F) << 6 | (s[2] & 0x3F);
  uint32_t code = (c & 0x07) << 18 | (s[1] & 0x3F) << 12 | (s[2] & 0x3F) << 6 | (s[3] & 0x3F);
  return 0xD800 + ((code - 0x10000) >> 10);
}

// a < b, a === b and a > b as -1, 0 and 1, by UTF-16 code units as JavaScript orders strings.
// That is UTF-8 byte order except where a character beyond U+FFFF meets one from U+E000 to
// U+FFFF, so the first differing character decides by its first code unit, and two with the
// same high surrogate by their bytes.
int32_t fsh_rt_str_compare(fsh_str *a, fsh_str *b) {
  int64_t n = a->length < b->length ? a->length : b->length;
  int64_t i = 0;
  while (i < n && a->bytes[i] == b->bytes[i]) i++;
  if (i == n) return a->length < b->length ? -1 : a->length > b->length ? 1 : 0;
  while (i > 0 && ((unsigned char)a->bytes[i] & 0xC0) == 0x80) i--;
  uint32_t x = fsh_unit((const unsigned char *)a->bytes + i), y = fsh_unit((const unsigned char *)b->bytes + i);
  if (x == y) return memcmp(a->bytes + i, b->bytes + i, n - i) < 0 ? -1 : 1;
  return x < y ? -1 : 1;
}

void fsh_rt_str_print(int32_t stream, fsh_str *s) {
  fwrite(s->bytes, 1, s->length, stream == 2 ? stderr : stdout);
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
