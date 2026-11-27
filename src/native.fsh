import { CASEMAP } from "./casemap.fsh";

// The C half of the runtime, compiled by the same clang call as a program's IR. Its entry
// points are named `fsh_rt_*`.

// Every allocation goes through fsh_rt_alloc and fsh_rt_free. With FISH_LEAKS=1 in the
// environment they count what is live, and a program reports at exit how many blocks it never
// freed; a --leaks build always reports them, grouped by where each was allocated.
//
// A string is a block: a reference count, its length in bytes, a pointer to its bytes, the
// block it shares them with when it is a slice, its UTF-16 length once known (-1 before), its
// breadcrumbs once built, then any bytes it holds itself. A count below zero marks a literal,
// which lives for the whole program, so retain and release skip it.

// A float is written as JavaScript's `String(x)` writes a number: the fewest digits that read
// back as the same value, in plain notation for exponents from -7 to 20 and in exponent
// notation otherwise. An f32 takes the fewest digits that read back as the same f32.
export const NATIVE = String.raw`
#ifdef __linux__
// For sched_getaffinity's CPU sets.
#define _GNU_SOURCE
#endif
#include <math.h>
#include <stdio.h>
#include <stdarg.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <unwind.h>
#include <pthread.h>
#include <sched.h>
#include <unistd.h>
#include <time.h>
#include <errno.h>
#include <pwd.h>
#include <limits.h>
#include <sys/random.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/ioctl.h>
#include <dirent.h>
#include <ftw.h>
#include <signal.h>
#include <spawn.h>
#include <poll.h>
#include <sys/wait.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <arpa/inet.h>
#include <netdb.h>
#ifdef __APPLE__
#include <sys/event.h>
#include <mach-o/dyld.h>
#else
#include <sys/epoll.h>
#include <sys/eventfd.h>
#endif

// Tasks run on several threads, so everything they share is counted atomically.
static int64_t fsh_live = 0;
// Whether blocks are counted, -1 until the first allocation asks. Only a leak report reads the
// count, and one counter every thread writes at each allocation and free slows a server down, so
// a program not asked for its leaks counts nothing. A top-level const's constructor may allocate
// before any of this file's run, which is why the first allocation reads the environment.
#ifdef FSH_LEAK_SITES
static int32_t fsh_counting = 1;
#else
static int32_t fsh_counting = -1;
#endif

static int32_t fsh_counts(void) {
  int32_t counting = __atomic_load_n(&fsh_counting, __ATOMIC_RELAXED);
  if (counting < 0) {
    const char *check = getenv("FISH_LEAKS");
    counting = check && check[0] == '1';
    __atomic_store_n(&fsh_counting, counting, __ATOMIC_RELAXED);
  }
  return counting;
}
// Set when the program ends with tasks still running, whose memory is never freed.
static int32_t fsh_abandoned = 0;
// File jobs the blocking pool holds, whose memory is still live when a program ends mid-read.
static int64_t fsh_pool_busy = 0;
// Set once runtime teardown begins; checked before injecting tasks or aborting process.shutdown.
static int32_t fsh_stopping = 0;
// Set while fsh_shutdown_watch is aborting process.shutdown.
static int32_t fsh_shutdown_busy = 0;

#ifdef FSH_LEAK_SITES
// A --leaks build's blocks each start with a header naming the allocation's site, on one list
// the report walks at exit. Its size keeps the block after it 16-byte aligned, as malloc's is.
typedef struct fsh_block { const char *site; const char *name; int64_t size; struct fsh_block *prev, *next; int64_t pad; } fsh_block;
static fsh_block fsh_blocks = { NULL, NULL, 0, &fsh_blocks, &fsh_blocks, 0 };
static pthread_mutex_t fsh_blocks_lock = PTHREAD_MUTEX_INITIALIZER;
static void fsh_site(fsh_block *b);
#endif

void *fsh_rt_alloc(int64_t size) {
#ifdef FSH_LEAK_SITES
  // A size the header would overflow fails as one malloc can't give.
  fsh_block *b = size < 0 || size > INT64_MAX - (int64_t)sizeof(fsh_block) ? NULL : malloc(sizeof(fsh_block) + size);
  void *p = b ? b + 1 : NULL;
#else
  void *p = malloc(size);
#endif
  if (!p) {
    fputs("out of memory\n", stderr);
    exit(101);
  }
  if (fsh_counts()) __atomic_fetch_add(&fsh_live, 1, __ATOMIC_RELAXED);
#ifdef FSH_LEAK_SITES
  fsh_site(b);
  b->size = size;
  pthread_mutex_lock(&fsh_blocks_lock);
  b->prev = &fsh_blocks;
  b->next = fsh_blocks.next;
  b->next->prev = b;
  fsh_blocks.next = b;
  pthread_mutex_unlock(&fsh_blocks_lock);
#endif
  return p;
}

void fsh_rt_free(void *p) {
  if (!p) return;
  if (fsh_counts()) __atomic_fetch_sub(&fsh_live, 1, __ATOMIC_RELAXED);
#ifdef FSH_LEAK_SITES
  fsh_block *b = (fsh_block *)p - 1;
  pthread_mutex_lock(&fsh_blocks_lock);
  b->prev->next = b->next;
  b->next->prev = b->prev;
  pthread_mutex_unlock(&fsh_blocks_lock);
  p = b;
#endif
  free(p);
}

// What drops the program's top-level consts at exit, which the leak check runs first, unless tasks
// were left running, which may still read them.
static void (*fsh_constants_drop)(void) = NULL;

void fsh_rt_constants(void (*drop)(void)) {
  fsh_constants_drop = drop;
}

// What tears the JS engine down, when the program has one, so what JS still holds, like Fish
// callbacks, is freed before the leak check counts it; after a panic, values it left held keep
// the engine from being torn down. Only a panic that ends the program counts: one a spawned task
// isolated has dropped what it held.
static void (*fsh_engine_end)(void) = NULL;
static int32_t fsh_panic_began = 0;
// What frees the list of tasks that waited on the shutdown signal, when the program asked for it:
// the signal itself lives to the end, so nothing else frees it.
static void (*fsh_shutdown_end)(void) = NULL;

#ifdef FSH_LEAK_SITES
static void fsh_leak_report(void);
#endif

__attribute__((destructor)) static void fsh_leaks(void) {
  __atomic_store_n(&fsh_stopping, 1, __ATOMIC_SEQ_CST);
  if (__atomic_load_n(&fsh_pool_busy, __ATOMIC_SEQ_CST) != 0 || __atomic_load_n(&fsh_shutdown_busy, __ATOMIC_SEQ_CST) != 0) fsh_abandoned = 1;
  if (fsh_constants_drop && !fsh_abandoned) fsh_constants_drop();
  if (fsh_shutdown_end && !fsh_abandoned) fsh_shutdown_end();
  // A program that never allocated never asked, and has nothing to report.
  int32_t check = __atomic_load_n(&fsh_counting, __ATOMIC_RELAXED) > 0;
  if (check && fsh_engine_end && !fsh_abandoned && !fsh_panic_began) fsh_engine_end();
  int64_t live = __atomic_load_n(&fsh_live, __ATOMIC_RELAXED);
  // After a panic, what JS frames it unwound held is still live in the engine, not leaked.
  int32_t held = fsh_engine_end && fsh_panic_began;
#ifdef FSH_LEAK_SITES
  if (live != 0 && !fsh_abandoned && !held) fsh_leak_report();
#else
  if (check && live != 0 && !fsh_abandoned && !held) fprintf(stderr, "fish: leaked %lld allocations\n", (long long)live);
#endif
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

// The pieces of an array's join, gathered so they are joined once, in time linear in the result.
typedef struct { fsh_str **parts; int64_t count, capacity; } fsh_joining;

void *fsh_rt_join_start(void) {
  return calloc(1, sizeof(fsh_joining));
}

void fsh_rt_join_push(fsh_joining *j, fsh_str *s) {
  if (j->count == j->capacity) {
    j->capacity = j->capacity > 0 ? j->capacity * 2 : 8;
    j->parts = realloc(j->parts, (size_t)j->capacity * sizeof(fsh_str *));
  }
  fsh_rt_str_retain(s);
  j->parts[j->count++] = s;
}

fsh_str *fsh_rt_join_end(fsh_joining *j) {
  fsh_str *s = fsh_rt_str_join(j->parts, j->count);
  for (int64_t i = 0; i < j->count; i++) fsh_rt_str_release(j->parts[i]);
  free(j->parts);
  free(j);
  return s;
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

// s.at(i): the one-unit string, a negative i counting from the end, or NULL past either end.
fsh_str *fsh_rt_str_at_or_null(fsh_str *s, int64_t i) {
  int64_t n = fsh_rt_str_units(s);
  if (i < 0) i += n;
  return i < 0 || i >= n ? NULL : fsh_rt_str_at(s, i);
}

// s.charAt(i): the one-unit string, or an empty one out of range.
fsh_str *fsh_rt_str_char_at(fsh_str *s, int64_t i) {
  if (i < 0 || i >= fsh_rt_str_units(s)) return fsh_str_of("", 0);
  return fsh_rt_str_at(s, i);
}

// s.codePointAt(i): the code point a pair starting at i makes, or the unit there, or -1 past
// the end.
int64_t fsh_rt_str_code_point_at(fsh_str *s, int64_t i) {
  int64_t n = fsh_rt_str_units(s);
  if (i < 0 || i >= n) return -1;
  uint16_t high = fsh_rt_str_unit(s, i);
  if (high < 0xD800 || high > 0xDBFF || i + 1 >= n) return high;
  uint16_t low = fsh_rt_str_unit(s, i + 1);
  if (low < 0xDC00 || low > 0xDFFF) return high;
  return 0x10000 + ((int64_t)(high - 0xD800) << 10) + (low - 0xDC00);
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

// Where needle last occurs in s starting at or before unit from, by units, or -1.
int64_t fsh_rt_str_last_index_of(fsh_str *s, fsh_str *needle, int64_t from) {
  int64_t n = fsh_rt_str_units(s), m = fsh_rt_str_units(needle);
  from = fsh_clamp(from, n);
  if (m > n) return -1;
  if (from > n - m) from = n - m;
  // By bytes, back from where unit from is, at each character's start; the unit a match is at
  // is its byte offset when every character is one byte, else counted up to it.
  if (needle->length == 0) return from;
  if (!fsh_has_lone(needle)) {
    int half;
    int64_t start = fsh_seek(s, from, &half);
    for (int64_t at = start; at >= 0; at--) {
      if ((((const unsigned char *)s->bytes)[at] & 0xc0) == 0x80) continue;
      if (at + needle->length > s->length || memcmp(s->bytes + at, needle->bytes, needle->length) != 0) continue;
      if (n == s->length) return at;
      int64_t unit = 0, i = 0;
      int h = 0;
      while (i < at) {
        fsh_next((const unsigned char *)s->bytes, &i, &h);
        unit++;
      }
      return unit;
    }
    return -1;
  }
  uint16_t *a = fsh_utf16(s), *b = fsh_utf16(needle);
  int64_t found = -1;
  for (int64_t i = from; found < 0 && i >= 0; i--) {
    if (memcmp(a + i, b, m * sizeof(uint16_t)) == 0) found = i;
  }
  fsh_rt_free(a);
  fsh_rt_free(b);
  return found;
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
  if (actions & _UA_END_OF_STACK) {
    fsh_panic_began = 1;
    exit(101);
  }
  return _URC_NO_REASON;
}

// Every panic: the message, after what was already printed, then an abort, or an unwind that
// runs each frame's drops and exits with 101 once it reaches the end of the stack.
// Each thread's token, which marks the locks it holds. A panic leaves its locks held, and the
// thread takes a new token, so a task it runs next waits for them rather than seeing its own.
static int32_t fsh_tokens = 0;
static _Thread_local int32_t fsh_token = 0;

// A debug build's shadow stack: a frame for each of the program's own functions that is running,
// pushed on entry and popped on return by the program's IR, naming the function and the call it
// is making. A release build never touches it.
typedef struct fsh_frame { const char *site; const char *name; struct fsh_frame *prev; } fsh_frame;
_Thread_local fsh_frame *fsh_rt_frames = NULL;
#ifdef FSH_PROFILE
static int fsh_prof_register(void);
static void fsh_prof_unregister(int slot);
static int fsh_prof_is_active(void);
#endif
// Where the task this thread is polling was spawned, and the panic's "panicked at" line.
static _Thread_local const char *fsh_spawned_at = NULL;
static _Thread_local const char *fsh_panic_line = NULL;

#ifdef FSH_LEAK_SITES
// A block's site: the innermost of the program's own frames, so a block std makes is charged to
// the program's call into std, and <runtime> when there is none.
static void fsh_site(fsh_block *b) {
  b->site = fsh_rt_frames ? fsh_rt_frames->site : NULL;
  b->name = fsh_rt_frames ? fsh_rt_frames->name : NULL;
}

typedef struct { const char *site; const char *name; int64_t count, bytes; } fsh_leak;

static int fsh_text_order(const char *a, const char *b) {
  return a == b ? 0 : !a ? -1 : !b ? 1 : strcmp(a, b);
}

// Sites are "file:line:col", ordered by file, then line, then column, as numbers.
static int fsh_site_order(const char *a, const char *b) {
  if (!a || !b) return fsh_text_order(a, b);
  const char *ca = strrchr(a, ':'), *cb = strrchr(b, ':');
  const char *la = ca, *lb = cb;
  while (la > a && la[-1] != ':') la--;
  while (lb > b && lb[-1] != ':') lb--;
  if (la == a || lb == b) return strcmp(a, b);
  size_t fa = la - 1 - a, fb = lb - 1 - b;
  int c = strncmp(a, b, fa < fb ? fa : fb);
  if (c || fa != fb) return c ? c : fa < fb ? -1 : 1;
  long long na = atoll(la), nb = atoll(lb);
  if (na != nb) return na < nb ? -1 : 1;
  na = atoll(ca + 1), nb = atoll(cb + 1);
  return na < nb ? -1 : na > nb;
}

static int fsh_by_site(const void *x, const void *y) {
  const fsh_leak *a = x, *b = y;
  int c = fsh_text_order(a->name, b->name);
  return c ? c : fsh_text_order(a->site, b->site);
}

// Largest group first: by count, then bytes, then where.
static int fsh_by_size(const void *x, const void *y) {
  const fsh_leak *a = x, *b = y;
  if (a->count != b->count) return a->count > b->count ? -1 : 1;
  if (a->bytes != b->bytes) return a->bytes > b->bytes ? -1 : 1;
  int c = fsh_site_order(a->site, b->site);
  return c ? c : fsh_text_order(a->name, b->name);
}

// Every block still live, grouped by site, after anything the program printed.
static void fsh_leak_report(void) {
  pthread_mutex_lock(&fsh_blocks_lock);
  int64_t n = 0, total = 0;
  for (fsh_block *b = fsh_blocks.next; b != &fsh_blocks; b = b->next) n++;
  fsh_leak *all = malloc((n ? n : 1) * sizeof(fsh_leak));
  if (!all) abort();
  n = 0;
  for (fsh_block *b = fsh_blocks.next; b != &fsh_blocks; b = b->next) {
    all[n++] = (fsh_leak){ b->site, b->name, 1, b->size };
    total += b->size;
  }
  pthread_mutex_unlock(&fsh_blocks_lock);
  qsort(all, n, sizeof(fsh_leak), fsh_by_site);
  int64_t groups = 0;
  for (int64_t i = 0; i < n; i++) {
    if (groups > 0 && fsh_by_site(&all[groups - 1], &all[i]) == 0) {
      all[groups - 1].count++;
      all[groups - 1].bytes += all[i].bytes;
    } else all[groups++] = all[i];
  }
  qsort(all, groups, sizeof(fsh_leak), fsh_by_size);
  fflush(NULL);
  fprintf(stderr, "fish: leaked %lld allocation%s (%lld byte%s)\n", (long long)n, n == 1 ? "" : "s", (long long)total, total == 1 ? "" : "s");
  for (int64_t i = 0; i < groups; i++) {
    fsh_leak *g = &all[i];
    fprintf(stderr, "  %lld allocation%s, %lld byte%s, ", (long long)g->count, g->count == 1 ? "" : "s", (long long)g->bytes, g->bytes == 1 ? "" : "s");
    if (!g->name) fputs("at <runtime>\n", stderr);
    else if (g->site) fprintf(stderr, "at %s in %s\n", g->site, g->name);
    else fprintf(stderr, "in %s\n", g->name);
  }
  free(all);
}
#endif

static void fsh_panic_at(const char *at) {
  fflush(NULL);
  fputs(at, stderr);
  fsh_panic_line = at;
}

// The stack, innermost first, numbered as Rust's is. The innermost frame is where the panic
// happened, unless that is inside std or one of its built-in modules, whose frames are hidden:
// then it is the frame's call into std.
static void fsh_backtrace(void) {
  if (!fsh_rt_frames) return;
  fputs("stack backtrace:\n", stderr);
  const char *at = fsh_panic_line && strncmp(fsh_panic_line, "panicked at ", 12) == 0 ? fsh_panic_line + 12 : NULL;
  if (at && (strncmp(at, "<fish std>", 10) == 0 || strncmp(at, "std:", 4) == 0)) at = NULL;
  int64_t n = 0;
  for (fsh_frame *f = fsh_rt_frames; f; f = f->prev, n++) {
    if (n == 64) {
      int64_t rest = 0;
      for (; f; f = f->prev) rest++;
      fprintf(stderr, "... %lld more frames\n", (long long)rest);
      break;
    }
    if (n == 0 && at) fprintf(stderr, "%4lld: %s at %.*s\n", (long long)n, f->name, (int)strcspn(at, "\n") - 1, at);
    else if (f->site) fprintf(stderr, "%4lld: %s at %s\n", (long long)n, f->name, f->site);
    else fprintf(stderr, "%4lld: %s\n", (long long)n, f->name);
  }
  if (fsh_spawned_at) fprintf(stderr, "spawned at %s\n", fsh_spawned_at);
}
// A panic's reason, without its "panicked at" line, kept for the task it ends: a TaskPanic's
// message, or what its awaiter's own panic names. A long one is cut short.
static _Thread_local char fsh_reason[1024];
static _Thread_local int32_t fsh_reason_given = 0;
static void fsh_panic_reason(const char *bytes, size_t length) {
  while (length > 0 && bytes[length - 1] == '\n') length--;
  // A cut lands on a character's first byte, so the reason stays valid text.
  if (length >= sizeof fsh_reason) {
    length = sizeof fsh_reason - 1;
    while (length > 0 && ((unsigned char)bytes[length] & 0xC0) == 0x80) length--;
  }
  memcpy(fsh_reason, bytes, length);
  fsh_reason[length] = 0;
  fsh_reason_given = 1;
}

// Tokens of threads that panicked holding a lock, so whoever waits for one is told rather than
// waiting forever: Rust's poisoning.
static pthread_mutex_t fsh_poison_lock = PTHREAD_MUTEX_INITIALIZER;
static int32_t *fsh_poison_tokens = NULL;
static int64_t fsh_poison_count = 0;
// How many locks this thread holds, so a call into JS under one, which could wait forever on a
// callback JS runs that takes the same lock, is refused.
static _Thread_local int32_t fsh_locks_held = 0;
// The RwLock words this thread reads under, innermost last.
static _Thread_local int32_t **fsh_reading = NULL;
static _Thread_local int64_t fsh_reading_count = 0, fsh_reading_capacity = 0;
// How many Fish callbacks JS is running on this thread. A panic in one would unwind through the
// engine's frames, leaving its lock held, so it ends the program instead, as Rust's panics that
// would cross foreign frames do.
static _Thread_local int32_t fsh_in_js = 0;

void fsh_rt_panic(const char *message) {
  static _Thread_local struct _Unwind_Exception exception;
  if (!fsh_reason_given) {
    const char *nl = strncmp(message, "panicked ", 9) == 0 ? strchr(message, '\n') : NULL;
    const char *reason = nl ? nl + 1 : message;
    fsh_panic_reason(reason, strlen(reason));
  }
  fsh_reason_given = 0;
  // A reader changed nothing, so its hold is given back rather than poisoning the lock, as in
  // Rust; the unwind skips the release after its callback.
  for (int64_t i = fsh_reading_count - 1; i >= 0; i--) __atomic_sub_fetch(fsh_reading[i], 1, __ATOMIC_RELEASE);
  fsh_locks_held -= (int32_t)fsh_reading_count;
  fsh_reading_count = 0;
  if (fsh_locks_held > 0 && fsh_token) {
    pthread_mutex_lock(&fsh_poison_lock);
    fsh_poison_tokens = realloc(fsh_poison_tokens, (fsh_poison_count + 1) * sizeof(int32_t));
    fsh_poison_tokens[fsh_poison_count++] = fsh_token;
    pthread_mutex_unlock(&fsh_poison_lock);
  }
  fsh_locks_held = 0;
  fsh_token = 0;
  fflush(NULL);
  fputs(message, stderr);
  if (strncmp(message, "panicked at ", 12) == 0) fsh_panic_line = message;
  fsh_backtrace();
  fsh_panic_line = NULL;
  // An unwind pops no frame, and a drop it runs may panic again: that panic starts from nothing,
  // rather than walking frames the unwind already left. A task's poller gets its own stack back.
  fsh_rt_frames = NULL;
  if (fsh_panic_abort) abort();
  if (fsh_in_js > 0) {
    fsh_panic_began = 1;
    exit(101);
  }
  exception.exception_class = 0x46495348; // "FISH"
  _Unwind_ForcedUnwind(&exception, fsh_unwound, NULL);
  fsh_panic_began = 1;
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
    fsh_panic_at(at);
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

// An array's elements, each all zero bits, as a value not yet set is.
void *fsh_rt_array_zeroed(int64_t bytes) {
  void *p = fsh_rt_array_alloc(bytes);
  if (p) memset(p, 0, bytes);
  return p;
}

// Bytes copied between typed arrays, or a number's bits taken as another's, for std's DataView.
void fsh_rt_bytes_copy(void *to, const void *from, int64_t count) {
  if (count > 0) memmove(to, from, count);
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

// Deterministic simulation mode: activated when FISH_SIM_SEED is set in the environment.
// Drives map seeding, PRNG, virtual monotonic/wall clocks, single-threaded task scheduling,
// and an in-memory virtual TCP network with fault injection. Zero overhead when unset.
static int32_t fsh_sim_inited = 0;
static int32_t fsh_sim_active = 0;
static uint64_t fsh_sim_seed_val = 0;
static uint64_t fsh_sim_user_rng[4];
static uint64_t fsh_sim_sched_rng[4];
static int64_t fsh_sim_now_ns = 0;
static const int64_t FSH_SIM_EPOCH_MS = 1704067200000LL; // 2024-01-01T00:00:00.000Z

static uint64_t fsh_sim_splitmix64(uint64_t *state) {
  uint64_t z = (*state += 0x9e3779b97f4a7c15ULL);
  z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
  z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
  return z ^ (z >> 31);
}

static uint64_t fsh_sim_rotl64(uint64_t x, int k) {
  return (x << k) | (x >> (64 - k));
}

static uint64_t fsh_sim_next_u64(uint64_t s[4]) {
  const uint64_t result = fsh_sim_rotl64(s[1] * 5, 7) * 9;
  const uint64_t t = s[1] << 17;
  s[2] ^= s[0];
  s[3] ^= s[1];
  s[1] ^= s[2];
  s[0] ^= s[3];
  s[2] ^= t;
  s[3] = fsh_sim_rotl64(s[3], 45);
  return result;
}

static double fsh_sim_next_f64(uint64_t s[4]) {
  return (double)(fsh_sim_next_u64(s) >> 11) * 0x1.0p-53;
}

static void fsh_sim_init(void) {
  if (fsh_sim_inited) return;
  fsh_sim_inited = 1;
  const char *env = getenv("FISH_SIM_SEED");
  if (!env || !env[0]) return;
  const char *p = env;
  while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r') p++;
  if (!*p || *p == '-' || *p == '+') {
    fprintf(stderr, "fish sim: invalid FISH_SIM_SEED '%s' (expected unsigned 64-bit integer)\n", env);
    fsh_abandoned = 1;
    exit(2);
  }
  errno = 0;
  char *end = NULL;
  unsigned long long parsed = strtoull(p, &end, 10);
  if (errno == ERANGE || end == p) {
    fprintf(stderr, "fish sim: invalid FISH_SIM_SEED '%s' (expected unsigned 64-bit integer)\n", env);
    fsh_abandoned = 1;
    exit(2);
  }
  while (*end == ' ' || *end == '\t' || *end == '\n' || *end == '\r') end++;
  if (*end != '\0') {
    fprintf(stderr, "fish sim: invalid FISH_SIM_SEED '%s' (expected unsigned 64-bit integer)\n", env);
    fsh_abandoned = 1;
    exit(2);
  }
  fsh_sim_active = 1;
  fsh_sim_seed_val = (uint64_t)parsed;
  fsh_sim_now_ns = 0;
  uint64_t su = fsh_sim_seed_val ^ 0x9e3779b97f4a7c15ULL;
  uint64_t ss = fsh_sim_seed_val ^ 0xbf58476d1ce4e5b9ULL;
  for (int i = 0; i < 4; i++) {
    fsh_sim_user_rng[i] = fsh_sim_splitmix64(&su);
    fsh_sim_sched_rng[i] = fsh_sim_splitmix64(&ss);
  }
}

__attribute__((constructor)) static void fsh_sim_boot(void) {
  fsh_sim_init();
}

// Set once before main, so every thread hashes with the same seed. A top-level const's table is
// made by another constructor, which may run first, so whichever comes first seeds it.
static uint64_t fsh_map_seed = 0;

__attribute__((constructor)) static void fsh_map_seeding(void) {
  fsh_sim_init();
  if (fsh_map_seed != 0) return;
  if (fsh_sim_active) {
    uint64_t st = fsh_sim_seed_val ^ 0x243f6a8885a308d3ULL;
    fsh_map_seed = fsh_sim_splitmix64(&st) | 1;
    return;
  }
  if (getentropy(&fsh_map_seed, sizeof fsh_map_seed) != 0) fsh_map_seed = (uint64_t)(intptr_t)&fsh_map_seed;
  fsh_map_seed |= 1;
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
  fsh_map_seeding();
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

// A dictionary's entries in the order JavaScript gives an object's keys: those that are array
// indexes ascending, then the rest as they were made, then the removed ones. The table keeps
// insertion order; this order is the caller's, read while it reads the entries, then freed.
typedef struct {
  uint64_t n;
  int64_t i;
} fsh_dict_index;

static int fsh_dict_index_cmp(const void *a, const void *b) {
  uint64_t x = ((const fsh_dict_index *)a)->n, y = ((const fsh_dict_index *)b)->n;
  return x < y ? -1 : x > y;
}

// Whether a key is an array index: a canonical decimal integer below 2^32 - 1.
static int fsh_dict_numeric(fsh_str *s, uint64_t *n) {
  if (s->length == 0 || s->length > 10 || (s->length > 1 && s->bytes[0] == '0')) return 0;
  uint64_t v = 0;
  for (int64_t i = 0; i < s->length; i++) {
    if (s->bytes[i] < '0' || s->bytes[i] > '9') return 0;
    v = v * 10 + (uint64_t)(s->bytes[i] - '0');
  }
  *n = v;
  return v < 4294967295ull;
}

int64_t *fsh_rt_dict_order(fsh_map *m) {
  int64_t *order = fsh_rt_alloc((m->used + 1) * sizeof(int64_t));
  fsh_dict_index *numbers = fsh_rt_alloc((m->used + 1) * sizeof(fsh_dict_index));
  int64_t count = 0, at = 0;
  for (int64_t i = 0; i < m->used; i++) {
    uint8_t *e = m->entries + i * m->size;
    uint64_t n;
    if (((fsh_entry *)e)->state == 1 && fsh_dict_numeric(*(fsh_str **)(e + m->key_at), &n)) numbers[count++] = (fsh_dict_index){n, i};
  }
  qsort(numbers, (size_t)count, sizeof(fsh_dict_index), fsh_dict_index_cmp);
  for (int64_t i = 0; i < count; i++) order[at++] = numbers[i].i;
  for (int64_t i = 0; i < m->used; i++) {
    uint8_t *e = m->entries + i * m->size;
    uint64_t n;
    if (((fsh_entry *)e)->state == 1 && !fsh_dict_numeric(*(fsh_str **)(e + m->key_at), &n)) order[at++] = i;
  }
  for (int64_t i = 0; i < m->used; i++) if (((fsh_entry *)(m->entries + i * m->size))->state != 1) order[at++] = i;
  fsh_rt_free(numbers);
  return order;
}

void *fsh_rt_dict_at(fsh_map *m, int64_t *order, int64_t i) {
  return fsh_map_entry(m, order[i]);
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

// Parts of a string being built, joined and released once all are in.
typedef struct {
  fsh_str **items;
  int64_t count, room;
} fsh_parts;

static void fsh_parts_add(fsh_parts *p, fsh_str *part) {
  if (p->count == p->room) {
    int64_t room = p->room ? p->room * 2 : 8;
    fsh_str **items = fsh_rt_alloc(room * sizeof(fsh_str *));
    if (p->count) memcpy(items, p->items, p->count * sizeof(fsh_str *));
    fsh_rt_free(p->items);
    p->items = items;
    p->room = room;
  }
  p->items[p->count++] = part;
}

static fsh_str *fsh_parts_join(fsh_parts *p) {
  fsh_str *joined = fsh_join_parts(p->items, p->count);
  fsh_rt_free(p->items);
  return joined;
}

// A string replacement for the match of s from unit at to end, n units long: in it $$ is $,
// $& the match, $ and a backtick (0x60) what comes before it, and $' what comes after, as
// JavaScript's replace and replaceAll with a string pattern read it.
static void fsh_replacement(fsh_parts *p, fsh_str *s, fsh_str *replacement, int64_t at, int64_t end, int64_t n) {
  const char *r = replacement->bytes;
  int64_t from = 0;
  for (int64_t i = 0; i + 1 < replacement->length; i++) {
    if (r[i] != '$' || (r[i + 1] != '$' && r[i + 1] != '&' && r[i + 1] != 0x60 && r[i + 1] != '\'')) continue;
    fsh_parts_add(p, fsh_share(replacement, from, r[i + 1] == '$' ? i + 1 : i));
    if (r[i + 1] == '&') fsh_parts_add(p, fsh_sub(s, at, end));
    else if (r[i + 1] == 0x60) fsh_parts_add(p, fsh_sub(s, 0, at));
    else if (r[i + 1] == '\'') fsh_parts_add(p, fsh_sub(s, end, n));
    from = i + 2;
    i++;
  }
  fsh_parts_add(p, fsh_share(replacement, from, replacement->length));
}

// JavaScript's replace with a string pattern: the first match is replaced.
fsh_str *fsh_rt_str_replace(fsh_str *s, fsh_str *pattern, fsh_str *replacement) {
  int64_t at = fsh_rt_str_index_of(s, pattern, 0);
  if (at < 0) {
    fsh_rt_str_retain(s);
    return s;
  }
  int64_t n = fsh_rt_str_units(s), end = at + fsh_rt_str_units(pattern);
  fsh_parts p = { 0 };
  fsh_parts_add(&p, fsh_sub(s, 0, at));
  fsh_replacement(&p, s, replacement, at, end, n);
  fsh_parts_add(&p, fsh_sub(s, end, n));
  return fsh_parts_join(&p);
}

// JavaScript's replaceAll with a string pattern: every match, left to right and not
// overlapping; an empty pattern matches before every unit and at the end.
fsh_str *fsh_rt_str_replace_all(fsh_str *s, fsh_str *pattern, fsh_str *replacement) {
  int64_t n = fsh_rt_str_units(s), m = fsh_rt_str_units(pattern);
  fsh_parts p = { 0 };
  int64_t last = 0;
  for (int64_t at = fsh_rt_str_index_of(s, pattern, 0); at >= 0 && at <= n;) {
    fsh_parts_add(&p, fsh_sub(s, last, at));
    fsh_replacement(&p, s, replacement, at, at + m, n);
    last = at + m;
    if (m == 0 && at == n) break;
    at = fsh_rt_str_index_of(s, pattern, m == 0 ? at + 1 : at + m);
  }
  fsh_parts_add(&p, fsh_sub(s, last, n));
  return fsh_parts_join(&p);
}

// One code point's UTF-8, a surrogate's as the 3-byte form Fish keeps a lone one in.
static int fsh_put_point(char *out, uint32_t c) {
  if (c < 0x80) { out[0] = c; return 1; }
  if (c < 0x800) { out[0] = 0xC0 | c >> 6; out[1] = 0x80 | (c & 0x3F); return 2; }
  if (c < 0x10000) { out[0] = 0xE0 | c >> 12; out[1] = 0x80 | (c >> 6 & 0x3F); out[2] = 0x80 | (c & 0x3F); return 3; }
  out[0] = 0xF0 | c >> 18; out[1] = 0x80 | (c >> 12 & 0x3F); out[2] = 0x80 | (c >> 6 & 0x3F); out[3] = 0x80 | (c & 0x3F);
  return 4;
}

// Code points as UTF-8, a high and a low surrogate side by side joining into their
// character, as they do in JavaScript's UTF-16; the units they make are counted.
static fsh_str *fsh_from_points(const uint32_t *points, int64_t n) {
  fsh_str *s = fsh_str_new(n * 4);
  char *at = (char *)s->own;
  int64_t units = 0;
  for (int64_t i = 0; i < n; i++) {
    uint32_t c = points[i];
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < n && points[i + 1] >= 0xDC00 && points[i + 1] <= 0xDFFF) {
      c = 0x10000 + ((c - 0xD800) << 10) + (points[++i] - 0xDC00);
    }
    units += c >= 0x10000 ? 2 : 1;
    at += fsh_put_point(at, c);
  }
  s->length = at - (char *)s->own;
  s->units = units;
  return s;
}

// String.fromCharCode: UTF-16 units.
fsh_str *fsh_rt_str_from_units(const uint16_t *units, int64_t n) {
  uint32_t *points = fsh_rt_alloc((n + 1) * sizeof(uint32_t));
  for (int64_t i = 0; i < n; i++) points[i] = units[i];
  fsh_str *s = fsh_from_points(points, n);
  fsh_rt_free(points);
  return s;
}

// String.fromCodePoint: one past 0x10FFFF is a panic, as JavaScript throws a RangeError for it.
fsh_str *fsh_rt_str_from_points(const uint32_t *points, int64_t n, const char *where) {
  for (int64_t i = 0; i < n; i++) {
    if (points[i] <= 0x10FFFF) continue;
    fsh_panic_at(where);
    char reason[64];
    snprintf(reason, sizeof reason, "invalid code point %u\n", points[i]);
    fsh_rt_panic(reason);
  }
  return fsh_from_points(points, n);
}

// The most bytes a string made by repeating may hold. Past it, making one panics, as
// JavaScript throws a RangeError; a usize count past i64's range arrives negative.
#define FSH_MAX_BYTES ((int64_t)1 << 40)

static void fsh_too_long(const char *at) {
  fsh_panic_at(at);
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
  fsh_panic_at(at);
  fsh_rt_panic(reason);
}

// The same for an index that counts back from the end when negative, shown as written.
void fsh_rt_panic_index(const char *at, int64_t length, int64_t index) {
  char reason[96];
  snprintf(reason, sizeof reason, "index out of bounds: the len is %lld but the index is %lld\n", (long long)length, (long long)index);
  fsh_panic_at(at);
  fsh_rt_panic(reason);
}

// An assertion's panic, its message the reason; at is the "panicked at" line. The message is
// released here, as the panic unwinds past the statement that would release it.
void fsh_rt_panic_assert(const char *at, fsh_str *message) {
  size_t length = message ? message->length : 0;
  fsh_panic_at(at);
  if (length > 0) fwrite(message->bytes, 1, length, stderr);
  fsh_panic_reason(length > 0 ? message->bytes : "", length);
  fsh_rt_str_release(message);
  fsh_rt_panic("\n");
}

// A Rust panic's message, which may hold NULs.
typedef struct { size_t length; char bytes[]; } fsh_rust_message;

// A panic a Rust function's shim caught: its message, kept where the call that raises it reads it.
void fsh_rt_rust_panicked(fsh_rust_message **out, const char *message, size_t length) {
  fsh_rust_message *copy = malloc(sizeof(fsh_rust_message) + length);
  if (!copy) {
    fputs("out of memory\n", stderr);
    exit(101);
  }
  copy->length = length;
  memcpy(copy->bytes, message, length);
  *out = copy;
}

// The Fish panic a Rust panic becomes at its call; at is the "panicked at" line.
void fsh_rt_panic_rust(const char *at, fsh_rust_message *reason) {
  fsh_panic_at(at);
  fwrite(reason->bytes, 1, reason->length, stderr);
  fsh_panic_reason(reason->bytes, reason->length);
  fsh_rt_panic("\n");
}

// A Fish string's bytes for Rust to read, WTF-8, a lone surrogate in its 3-byte form.
const char *fsh_rt_rust_str_bytes(fsh_str *s, int64_t *length) {
  *length = s ? s->length : 0;
  return s ? s->bytes : "";
}

// A string Rust gives Fish, its bytes UTF-8, copied into a Fish string.
fsh_str *fsh_rt_rust_str(const char *bytes, int64_t length) {
  return fsh_str_of(bytes, length);
}

// After a Rust value's drop: a panic in it, which the shim handed back, raised as a Fish panic.
void fsh_rt_rust_dropped(fsh_rust_message **caught, const char *at) {
  if (*caught) fsh_rt_panic_rust(at, *caught);
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
  fsh_sim_init();
  if (fsh_sim_active) return fsh_sim_now_ns / 1000000;
  struct timespec now;
  clock_gettime(CLOCK_MONOTONIC, &now);
  return (int64_t)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}

// The time now as an HTTP Date header writes it, like "Sun, 06 Nov 1994 08:49:37 GMT".
fsh_str *fsh_rt_http_date(void) {
  fsh_sim_init();
  time_t now = fsh_sim_active ? (time_t)(FSH_SIM_EPOCH_MS / 1000 + fsh_sim_now_ns / 1000000000) : time(NULL);
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

// A float as console.log prints one, which, unlike String(x), keeps the sign of -0.
char *fsh_rt_format_f64(double x, char *out) { return x == 0 && signbit(x) ? strcpy(out, "-0") : fsh_format(x, 0, out); }

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
char *fsh_rt_format_f32(float x, char *out) { return x == 0 && signbit(x) ? strcpy(out, "-0") : fsh_format(x, 1, out); }

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

#ifdef __linux__
// A checked 128-bit multiply, which LLVM calls for and libgcc doesn't have: the product, wrapped,
// and whether it overflowed. Weak, so compiler-rt's own is the one used where that is linked.
__attribute__((weak)) __int128 __muloti4(__int128 a, __int128 b, int *overflow) {
  const __int128 lowest = (__int128)((unsigned __int128)1 << 127);
  const __int128 highest = ~lowest;
  __int128 product = (__int128)((unsigned __int128)a * (unsigned __int128)b);
  *overflow = 0;
  if (a == lowest) { *overflow = b != 0 && b != 1; return product; }
  if (b == lowest) { *overflow = a != 0 && a != 1; return product; }
  __int128 x = a < 0 ? -a : a;
  __int128 y = b < 0 ? -b : b;
  if (x < 2 || y < 2) return product;
  *overflow = (a < 0) == (b < 0) ? x > highest / y : x > lowest / -y;
  return product;
}
#endif

// A 128-bit integer's decimal digits, which printf can't write: its length in out, which holds 41.
static int fsh_digits128(unsigned __int128 magnitude, int negative, char *out) {
  char reversed[40];
  int n = 0;
  do {
    reversed[n++] = (char)('0' + (int)(magnitude % 10));
    magnitude /= 10;
  } while (magnitude);
  int length = 0;
  if (negative) out[length++] = '-';
  while (n) out[length++] = reversed[--n];
  out[length] = 0;
  return length;
}

static int fsh_i128_digits(__int128 v, char *out) {
  return fsh_digits128(v < 0 ? -(unsigned __int128)v : (unsigned __int128)v, v < 0, out);
}

char *fsh_rt_format_i128(__int128 v, char *out) { fsh_i128_digits(v, out); return out; }
char *fsh_rt_format_u128(unsigned __int128 v, char *out) { fsh_digits128(v, 0, out); return out; }

fsh_str *fsh_rt_str_from_i128(__int128 v) {
  char text[41];
  fsh_i128_digits(v, text);
  return fsh_rt_str_from_cstring(text);
}

fsh_str *fsh_rt_str_from_u128(unsigned __int128 v) {
  char text[41];
  fsh_digits128(v, 0, text);
  return fsh_rt_str_from_cstring(text);
}

// A bigint: immutable once made and shared by count. Its magnitude is 'length' 32-bit limbs,
// least significant first, with no zero limb on top; zero has none and is never negative.
typedef struct fsh_big {
  int64_t count;
  int32_t negative;
  int64_t length;
  uint32_t limbs[];
} fsh_big;

static fsh_big *fsh_big_new(int64_t length) {
  fsh_big *b = fsh_rt_alloc(sizeof(fsh_big) + (length ? length : 1) * sizeof(uint32_t));
  b->count = 1;
  b->negative = 0;
  b->length = length;
  memset(b->limbs, 0, (length ? length : 1) * sizeof(uint32_t));
  return b;
}

static fsh_big *fsh_big_trim(fsh_big *b, int negative) {
  while (b->length && !b->limbs[b->length - 1]) b->length--;
  b->negative = b->length ? negative : 0;
  return b;
}

// A count below zero marks a constant the compiler made, never counted or freed.
void fsh_rt_big_retain(fsh_big *b) {
  if (__atomic_load_n(&b->count, __ATOMIC_RELAXED) >= 0) __atomic_fetch_add(&b->count, 1, __ATOMIC_RELAXED);
}

void fsh_rt_big_release(fsh_big *b) {
  if (b && __atomic_load_n(&b->count, __ATOMIC_RELAXED) >= 0 && __atomic_sub_fetch(&b->count, 1, __ATOMIC_ACQ_REL) == 0) fsh_rt_free(b);
}

static _Noreturn void fsh_big_panic(const char *where, const char *reason) {
  fflush(NULL);
  fputs(where, stderr);
  fsh_rt_panic(reason);
}

fsh_big *fsh_rt_big_from_u128(unsigned __int128 magnitude, int32_t negative) {
  fsh_big *b = fsh_big_new(4);
  for (int i = 0; i < 4; i++) b->limbs[i] = (uint32_t)(magnitude >> (32 * i));
  return fsh_big_trim(b, negative);
}

fsh_big *fsh_rt_big_from_i128(__int128 v) {
  return fsh_rt_big_from_u128(v < 0 ? -(unsigned __int128)v : (unsigned __int128)v, v < 0);
}

static int fsh_mag_cmp(const fsh_big *a, const fsh_big *b) {
  if (a->length != b->length) return a->length < b->length ? -1 : 1;
  for (int64_t i = a->length; i-- > 0;) if (a->limbs[i] != b->limbs[i]) return a->limbs[i] < b->limbs[i] ? -1 : 1;
  return 0;
}

int32_t fsh_rt_big_compare(const fsh_big *a, const fsh_big *b) {
  if (a->negative != b->negative) return a->negative ? -1 : 1;
  int c = fsh_mag_cmp(a, b);
  return a->negative ? -c : c;
}

_Bool fsh_rt_big_equal(const fsh_big *a, const fsh_big *b) { return fsh_rt_big_compare(a, b) == 0; }

static fsh_big *fsh_mag_add(const fsh_big *a, const fsh_big *b, int negative) {
  if (a->length < b->length) return fsh_mag_add(b, a, negative);
  fsh_big *r = fsh_big_new(a->length + 1);
  uint64_t carry = 0;
  for (int64_t i = 0; i < a->length; i++) {
    uint64_t t = (uint64_t)a->limbs[i] + (i < b->length ? b->limbs[i] : 0) + carry;
    r->limbs[i] = (uint32_t)t;
    carry = t >> 32;
  }
  r->limbs[a->length] = (uint32_t)carry;
  return fsh_big_trim(r, negative);
}

// |a| - |b|, where |a| >= |b|.
static fsh_big *fsh_mag_sub(const fsh_big *a, const fsh_big *b, int negative) {
  fsh_big *r = fsh_big_new(a->length);
  int64_t borrow = 0;
  for (int64_t i = 0; i < a->length; i++) {
    int64_t t = (int64_t)a->limbs[i] - (i < b->length ? b->limbs[i] : 0) - borrow;
    borrow = t < 0;
    r->limbs[i] = (uint32_t)(t + (borrow ? ((int64_t)1 << 32) : 0));
  }
  return fsh_big_trim(r, negative);
}

// a + b, with b's sign flipped when flip is set.
static fsh_big *fsh_big_add(const fsh_big *a, const fsh_big *b, int flip) {
  int bn = b->length ? b->negative ^ flip : 0;
  if (a->negative == bn) return fsh_mag_add(a, b, a->negative);
  return fsh_mag_cmp(a, b) >= 0 ? fsh_mag_sub(a, b, a->negative) : fsh_mag_sub(b, a, bn);
}

fsh_big *fsh_rt_big_add(const fsh_big *a, const fsh_big *b) { return fsh_big_add(a, b, 0); }
fsh_big *fsh_rt_big_sub(const fsh_big *a, const fsh_big *b) { return fsh_big_add(a, b, 1); }

fsh_big *fsh_rt_big_mul(const fsh_big *a, const fsh_big *b) {
  fsh_big *r = fsh_big_new(a->length + b->length);
  for (int64_t i = 0; i < a->length; i++) {
    uint64_t carry = 0;
    for (int64_t j = 0; j < b->length; j++) {
      uint64_t t = (uint64_t)a->limbs[i] * b->limbs[j] + r->limbs[i + j] + carry;
      r->limbs[i + j] = (uint32_t)t;
      carry = t >> 32;
    }
    r->limbs[i + b->length] = (uint32_t)carry;
  }
  return fsh_big_trim(r, a->negative ^ b->negative);
}

// |a| divided by |b|, which isn't zero: the quotient and remainder magnitudes.
// ponytail: shift-and-subtract, O(n^2) per bit of the dividend; Knuth's algorithm D if bigint
// division ever shows up in a profile.
static void fsh_mag_divmod(const fsh_big *a, const fsh_big *b, fsh_big **quotient, fsh_big **remainder) {
  fsh_big *q = fsh_big_new(a->length), *r = fsh_big_new(b->length + 1);
  r->length = 0;
  if (b->length == 1) {
    uint64_t rest = 0;
    for (int64_t i = a->length; i-- > 0;) {
      uint64_t t = (rest << 32) | a->limbs[i];
      q->limbs[i] = (uint32_t)(t / b->limbs[0]);
      rest = t % b->limbs[0];
    }
    r->limbs[0] = (uint32_t)rest;
    r->length = 1;
  } else {
    for (int64_t bit = a->length * 32; bit-- > 0;) {
      // r = r * 2 + the dividend's next bit.
      uint32_t carry = (a->limbs[bit / 32] >> (bit % 32)) & 1;
      for (int64_t i = 0; i < r->length; i++) {
        uint32_t top = r->limbs[i] >> 31;
        r->limbs[i] = (r->limbs[i] << 1) | carry;
        carry = top;
      }
      if (carry) r->limbs[r->length++] = carry;
      if (fsh_mag_cmp(r, b) >= 0) {
        int64_t borrow = 0;
        for (int64_t i = 0; i < r->length; i++) {
          int64_t t = (int64_t)r->limbs[i] - (i < b->length ? b->limbs[i] : 0) - borrow;
          borrow = t < 0;
          r->limbs[i] = (uint32_t)(t + (borrow ? ((int64_t)1 << 32) : 0));
        }
        while (r->length && !r->limbs[r->length - 1]) r->length--;
        q->limbs[bit / 32] |= (uint32_t)1 << (bit % 32);
      }
    }
  }
  *quotient = q;
  *remainder = r;
}

// Division truncates and a remainder takes the dividend's sign, as JavaScript's do.
fsh_big *fsh_rt_big_div(const fsh_big *a, const fsh_big *b, int32_t remainder, const char *where) {
  if (!b->length) fsh_big_panic(where, "Division by zero\n");
  fsh_big *q, *r;
  fsh_mag_divmod(a, b, &q, &r);
  if (remainder) {
    fsh_rt_free(q);
    return fsh_big_trim(r, a->negative);
  }
  fsh_rt_free(r);
  return fsh_big_trim(q, a->negative ^ b->negative);
}

fsh_big *fsh_rt_big_neg(const fsh_big *a) {
  fsh_big *r = fsh_big_new(a->length);
  memcpy(r->limbs, a->limbs, a->length * sizeof(uint32_t));
  return fsh_big_trim(r, !a->negative);
}

// The most bits a bigint may hold, as V8 allows.
#define FSH_BIG_MOST_BITS ((uint64_t)1 << 30)

static _Noreturn void fsh_big_too_big(const char *where) { fsh_big_panic(where, "Maximum BigInt size exceeded\n"); }

// A count of bits from a bigint, past which no result could be held.
static uint64_t fsh_big_small(const fsh_big *n, const char *where) {
  if (n->length > 1 || (n->length && n->limbs[0] > FSH_BIG_MOST_BITS)) fsh_big_too_big(where);
  return n->length ? n->limbs[0] : 0;
}

// The bits a magnitude takes.
static uint64_t fsh_big_bits(const fsh_big *a) {
  if (!a->length) return 0;
  return (uint64_t)(a->length - 1) * 32 + (32 - __builtin_clz(a->limbs[a->length - 1]));
}

fsh_big *fsh_rt_big_pow(const fsh_big *a, const fsh_big *e, const char *where) {
  if (e->negative) fsh_big_panic(where, "Exponent must be non-negative\n");
  // Checked before anything is made, so a panic leaves nothing behind.
  uint64_t n = a->length > 1 || (a->length == 1 && a->limbs[0] > 1) ? fsh_big_small(e, where) : 0;
  // At least (bits - 1) * n + 1 bits, and about n * log2|a|, which a power past the limit is
  // refused on before any multiplying.
  if (n) {
    uint64_t bits = fsh_big_bits(a);
    double lead = a->limbs[a->length - 1] + (a->length > 1 ? a->limbs[a->length - 2] / 4294967296.0 : 0);
    double log2a = (a->length - 1) * 32.0 + log2(lead);
    if ((bits - 1) * n + 1 > FSH_BIG_MOST_BITS || (double)n * log2a > (double)FSH_BIG_MOST_BITS) fsh_big_too_big(where);
  }
  fsh_big *result = fsh_rt_big_from_u128(1, 0), *base = fsh_rt_big_neg(a);
  base->negative = a->negative;
  if (!(a->length == 1 && a->limbs[0] == 1) && a->length) {
    for (; n; n >>= 1) {
      if (n & 1) {
        fsh_big *next = fsh_rt_big_mul(result, base);
        fsh_rt_free(result);
        result = next;
      }
      if (n > 1) {
        fsh_big *squared = fsh_rt_big_mul(base, base);
        fsh_rt_free(base);
        base = squared;
      }
    }
  } else if (!a->length) {
    // 0n ** 0n is 1n; any other power of zero is zero.
    if (e->length) result->length = 0;
  } else if (a->negative && e->length && (e->limbs[0] & 1)) {
    result->negative = 1;
  }
  fsh_rt_free(base);
  return result;
}

// |a| shifted right by n bits; 'rounded' is set when any one bit shifted out was set.
static fsh_big *fsh_mag_shr(const fsh_big *a, uint64_t n, int *rounded) {
  int64_t whole = (int64_t)(n / 32), bits = (int64_t)(n % 32);
  *rounded = 0;
  for (int64_t i = 0; i < whole && i < a->length; i++) if (a->limbs[i]) *rounded = 1;
  if (bits && whole < a->length && (a->limbs[whole] & (((uint32_t)1 << bits) - 1))) *rounded = 1;
  int64_t length = a->length > whole ? a->length - whole : 0;
  fsh_big *r = fsh_big_new(length);
  for (int64_t i = 0; i < length; i++) {
    uint64_t pair = a->limbs[i + whole] | (i + whole + 1 < a->length ? (uint64_t)a->limbs[i + whole + 1] << 32 : 0);
    r->limbs[i] = (uint32_t)(pair >> bits);
  }
  return r;
}

// a << n, or a >> -n; a right shift floors, as JavaScript's does.
fsh_big *fsh_rt_big_shift(const fsh_big *a, const fsh_big *count, int32_t right, const char *where) {
  if (count->negative) right = !right;
  if (!a->length) return fsh_big_new(0);
  if (right) {
    uint64_t n = count->length > 1 ? UINT64_MAX : count->length ? count->limbs[0] : 0;
    int rounded;
    fsh_big *r = fsh_big_trim(fsh_mag_shr(a, n, &rounded), a->negative);
    if (!(a->negative && rounded)) return r;
    // A negative value that lost set bits floors one further down.
    fsh_big *one = fsh_rt_big_from_u128(1, 1), *floored = fsh_rt_big_add(r, one);
    fsh_rt_free(r);
    fsh_rt_free(one);
    return floored;
  }
  uint64_t n = fsh_big_small(count, where);
  if (fsh_big_bits(a) + n > FSH_BIG_MOST_BITS) fsh_big_too_big(where);
  int64_t whole = (int64_t)(n / 32), bits = (int64_t)(n % 32);
  fsh_big *r = fsh_big_new(a->length + whole + 1);
  for (int64_t i = 0; i < a->length; i++) {
    uint64_t moved = (uint64_t)a->limbs[i] << bits;
    r->limbs[i + whole] |= (uint32_t)moved;
    r->limbs[i + whole + 1] |= (uint32_t)(moved >> 32);
  }
  return fsh_big_trim(r, a->negative);
}

// A value's two's complement in 'width' limbs, wide enough for any value in play.
static void fsh_big_twos(const fsh_big *a, uint32_t *out, int64_t width) {
  for (int64_t i = 0; i < width; i++) out[i] = i < a->length ? a->limbs[i] : 0;
  if (!a->negative) return;
  // -x is ~(x - 1).
  for (int64_t i = 0; i < width; i++) if (out[i]--) break;
  for (int64_t i = 0; i < width; i++) out[i] = ~out[i];
}

// &, | and ^ as op 0, 1 and 2, on two's complement of unbounded width.
fsh_big *fsh_rt_big_bitwise(const fsh_big *a, const fsh_big *b, int32_t op) {
  int64_t width = (a->length > b->length ? a->length : b->length) + 1;
  uint32_t *x = fsh_rt_alloc(width * sizeof(uint32_t)), *y = fsh_rt_alloc(width * sizeof(uint32_t));
  fsh_big_twos(a, x, width);
  fsh_big_twos(b, y, width);
  fsh_big *r = fsh_big_new(width);
  for (int64_t i = 0; i < width; i++) r->limbs[i] = op == 0 ? x[i] & y[i] : op == 1 ? x[i] | y[i] : x[i] ^ y[i];
  fsh_rt_free(x);
  fsh_rt_free(y);
  int negative = r->limbs[width - 1] >> 31;
  if (negative) {
    for (int64_t i = 0; i < width; i++) r->limbs[i] = ~r->limbs[i];
    for (int64_t i = 0; i < width; i++) if (++r->limbs[i]) break;
  }
  return fsh_big_trim(r, negative);
}

// ~a is -a - 1.
fsh_big *fsh_rt_big_not(const fsh_big *a) {
  fsh_big *one = fsh_rt_big_from_u128(1, 0), *r = fsh_big_add(one, a, 0);
  fsh_rt_free(one);
  r->negative = r->length ? !r->negative : 0;
  return r;
}

// The value's digits in a radix from 2 to 36, a '-' first when it is negative.
fsh_str *fsh_rt_big_text(const fsh_big *a, int64_t radix) {
  int64_t room = a->length * 32 + 2;
  char *digits = fsh_rt_alloc(room + 1);
  int64_t at = room;
  digits[at] = 0;
  fsh_big *rest = fsh_big_new(a->length);
  memcpy(rest->limbs, a->limbs, a->length * sizeof(uint32_t));
  do {
    uint64_t r = 0;
    for (int64_t i = rest->length; i-- > 0;) {
      uint64_t t = (r << 32) | rest->limbs[i];
      rest->limbs[i] = (uint32_t)(t / radix);
      r = t % radix;
    }
    while (rest->length && !rest->limbs[rest->length - 1]) rest->length--;
    digits[--at] = "0123456789abcdefghijklmnopqrstuvwxyz"[r];
  } while (rest->length);
  if (a->negative) digits[--at] = '-';
  fsh_rt_free(rest);
  fsh_str *s = fsh_rt_str_from_cstring(digits + at);
  fsh_rt_free(digits);
  return s;
}

// toString(radix), with JavaScript's RangeError for a radix it has no digits for.
fsh_str *fsh_rt_big_to_string(const fsh_big *a, int64_t radix, const char *where) {
  if (radix < 2 || radix > 36) fsh_big_panic(where, "toString() radix must be between 2 and 36\n");
  return fsh_rt_big_text(a, radix);
}

// The low 128 bits of the value's two's complement, which 'as' truncates to its type.
unsigned __int128 fsh_rt_big_low(const fsh_big *a) {
  unsigned __int128 v = 0;
  for (int64_t i = 0; i < 4 && i < a->length; i++) v |= (unsigned __int128)a->limbs[i] << (32 * i);
  return a->negative ? 0 - v : v;
}

// The nearest double, as Number(x) gives.
double fsh_rt_big_f64(const fsh_big *a) {
  fsh_str *text = fsh_rt_big_text(a, 10);
  double x = fsh_js_strtod((const unsigned char *)text->bytes, text->length);
  fsh_rt_str_release(text);
  return x;
}

void fsh_rt_json_i128(fsh_json_out *w, __int128 v) {
  char text[41];
  fsh_rt_json_raw(w, text, fsh_i128_digits(v, text));
}

void fsh_rt_json_u128(fsh_json_out *w, unsigned __int128 v) {
  char text[41];
  fsh_rt_json_raw(w, text, fsh_digits128(v, 0, text));
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

// JSON text being read: where it is, how deep in arrays and objects, the path to the value
// being read, as an error names it, and the error, kept from the attempt that read furthest
// when a union tries its members in turn.
typedef struct fsh_json_in {
  const unsigned char *p;
  int64_t n, at, depth;
  char *path;
  int64_t path_length, path_room;
  char *error;
  int64_t error_at;
  int32_t weak;
} fsh_json_in;

// ponytail: a fixed nesting limit keeps hostile input from overflowing the stack; make it an
// option if real data nests deeper
#define FSH_JSON_DEPTH 512

fsh_json_in *fsh_rt_json_in(fsh_str *s) {
  fsh_json_in *r = fsh_rt_alloc(sizeof(fsh_json_in));
  r->p = (const unsigned char *)s->bytes;
  r->n = s->length;
  r->at = 0;
  r->depth = 0;
  r->path_room = 64;
  r->path = fsh_rt_alloc(r->path_room);
  r->path[0] = '$';
  r->path_length = 1;
  r->error = NULL;
  r->error_at = -1;
  r->weak = 0;
  return r;
}

// The error's message, or NULL when there was none, with the reader freed.
fsh_str *fsh_rt_json_close(fsh_json_in *r) {
  fsh_str *message = r->error ? fsh_str_of(r->error, strlen(r->error)) : NULL;
  fsh_rt_free(r->error);
  fsh_rt_free(r->path);
  fsh_rt_free(r);
  return message;
}

static void fsh_json_path(fsh_json_in *r, const char *p, int64_t n) {
  if (r->path_length + n > r->path_room) {
    int64_t room = r->path_room * 2;
    while (room < r->path_length + n) room *= 2;
    char *path = fsh_rt_alloc(room);
    memcpy(path, r->path, r->path_length);
    fsh_rt_free(r->path);
    r->path = path;
    r->path_room = room;
  }
  memcpy(r->path + r->path_length, p, n);
  r->path_length += n;
}

// The path's length before a field's name or an element's index goes on it, to go back to.
int64_t fsh_rt_json_field_path(fsh_json_in *r, fsh_str *key) {
  int64_t mark = r->path_length;
  fsh_json_path(r, ".", 1);
  fsh_json_path(r, key->bytes, key->length);
  return mark;
}

int64_t fsh_rt_json_index_path(fsh_json_in *r, int64_t i) {
  int64_t mark = r->path_length;
  char text[24];
  fsh_json_path(r, text, snprintf(text, sizeof text, "[%lld]", (long long)i));
  return mark;
}

void fsh_rt_json_back(fsh_json_in *r, int64_t mark) {
  r->path_length = mark;
}

// Where reading is, so a union may try another member from the same place.
void fsh_rt_json_save(fsh_json_in *r, int64_t *mark) {
  mark[0] = r->at;
  mark[1] = r->path_length;
  mark[2] = r->depth;
}

void fsh_rt_json_restore(fsh_json_in *r, int64_t *mark) {
  r->at = mark[0];
  r->path_length = mark[1];
  r->depth = mark[2];
}

// Drops the errors of a union's members once one of them was read.
void fsh_rt_json_forget(fsh_json_in *r) {
  fsh_rt_free(r->error);
  r->error = NULL;
  r->error_at = -1;
}

// Keeps an error made at the reading position, unless one from further on is kept. A weak
// error, a value of another kind than wanted, gives way to another at the same place.
static int32_t fsh_json_kept(fsh_json_in *r, char *message, int32_t weak) {
  if (!r->error || r->at > r->error_at || (r->at == r->error_at && r->weak && !weak)) {
    fsh_rt_free(r->error);
    r->error = message;
    r->error_at = r->at;
    r->weak = weak;
  } else fsh_rt_free(message);
  return 0;
}

static int32_t fsh_json_error(fsh_json_in *r, char *message) {
  return fsh_json_kept(r, message, 0);
}

// Text that isn't JSON, in JavaScript's words.
static int32_t fsh_json_syntax(fsh_json_in *r) {
  char *message = fsh_rt_alloc(96);
  if (r->at >= r->n) snprintf(message, 96, "Unexpected end of JSON input");
  else {
    unsigned char c = r->p[r->at];
    int64_t width = c < 0x80 ? 1 : c < 0xE0 ? 2 : c < 0xF0 ? 3 : 4;
    if (r->at + width > r->n) width = r->n - r->at;
    snprintf(message, 96, "Unexpected token %.*s in JSON at position %lld", (int)width, (const char *)r->p + r->at, (long long)r->at);
  }
  return fsh_json_error(r, message);
}

static int32_t fsh_json_expected(fsh_json_in *r, const char *what, int32_t weak) {
  int64_t size = strlen(what) + r->path_length + 16;
  char *message = fsh_rt_alloc(size);
  snprintf(message, size, "expected %s at %.*s", what, (int)r->path_length, r->path);
  return fsh_json_kept(r, message, weak);
}

// A value of the wrong shape, with where it sits.
int32_t fsh_rt_json_expected(fsh_json_in *r, const char *what) {
  return fsh_json_expected(r, what, 0);
}

// A value of another kind, or another literal, than the one wanted.
int32_t fsh_rt_json_unlike(fsh_json_in *r, const char *what) {
  return fsh_json_expected(r, what, 1);
}

int32_t fsh_rt_json_missing(fsh_json_in *r, const char *name) {
  int64_t size = strlen(name) + r->path_length + 24;
  char *message = fsh_rt_alloc(size);
  snprintf(message, size, "missing field '%s' at %.*s", name, (int)r->path_length, r->path);
  return fsh_json_error(r, message);
}

static void fsh_json_space(fsh_json_in *r) {
  while (r->at < r->n && (r->p[r->at] == ' ' || r->p[r->at] == '\t' || r->p[r->at] == '\n' || r->p[r->at] == '\r')) r->at++;
}

// The next byte after white space, or -1 at the end.
int32_t fsh_rt_json_peek(fsh_json_in *r) {
  fsh_json_space(r);
  return r->at < r->n ? r->p[r->at] : -1;
}

static int fsh_json_word(fsh_json_in *r, const char *word, int64_t n) {
  if (r->n - r->at < n || memcmp(r->p + r->at, word, n) != 0) return 0;
  r->at += n;
  return 1;
}

// A value of another kind than the one wanted is a wrong shape; anything else isn't JSON.
static int32_t fsh_json_wrong(fsh_json_in *r, const char *what) {
  int32_t c = fsh_rt_json_peek(r);
  int starts = c == '{' || c == '[' || c == '"' || c == '-' || (c >= '0' && c <= '9') || c == 't' || c == 'f' || c == 'n';
  return starts ? fsh_rt_json_unlike(r, what) : fsh_json_syntax(r);
}

// After every member of a union failed: when none got past the value's start, one error
// naming the union says more than the last member's.
void fsh_rt_json_settle(fsh_json_in *r, int64_t *mark, const char *what) {
  fsh_rt_json_restore(r, mark);
  fsh_rt_json_peek(r);
  if (!r->error || !r->weak || r->error_at != r->at) return;
  fsh_rt_free(r->error);
  r->error = NULL;
  fsh_json_expected(r, what, 1);
}

int32_t fsh_rt_json_null(fsh_json_in *r) {
  if (fsh_rt_json_peek(r) == 'n' && fsh_json_word(r, "null", 4)) return 1;
  return fsh_json_wrong(r, "null");
}

int32_t fsh_rt_json_bool(fsh_json_in *r, int32_t *out) {
  int32_t c = fsh_rt_json_peek(r);
  if (c == 't' && fsh_json_word(r, "true", 4)) return *out = 1;
  if (c == 'f' && fsh_json_word(r, "false", 5)) {
    *out = 0;
    return 1;
  }
  return fsh_json_wrong(r, "boolean");
}

static int fsh_json_digit(fsh_json_in *r, int64_t i) {
  return i < r->n && r->p[i] >= '0' && r->p[i] <= '9';
}

// The length of the number at the reading position, and whether it is written whole; 0 with
// bad set to where it stops being one.
static int64_t fsh_json_number(fsh_json_in *r, int *whole, int64_t *bad) {
  int64_t i = r->at;
  *whole = 1;
  if (i < r->n && r->p[i] == '-') i++;
  if (!fsh_json_digit(r, i)) return *bad = i, 0;
  if (r->p[i] == '0') i++;
  else
    while (fsh_json_digit(r, i)) i++;
  if (i < r->n && r->p[i] == '.') {
    i++;
    *whole = 0;
    if (!fsh_json_digit(r, i)) return *bad = i, 0;
    while (fsh_json_digit(r, i)) i++;
  }
  if (i < r->n && (r->p[i] == 'e' || r->p[i] == 'E')) {
    i++;
    *whole = 0;
    if (i < r->n && (r->p[i] == '+' || r->p[i] == '-')) i++;
    if (!fsh_json_digit(r, i)) return *bad = i, 0;
    while (fsh_json_digit(r, i)) i++;
  }
  return i - r->at;
}

// An integer of the given width: written whole, or as a whole number a double holds exactly,
// as JavaScript would read it.
int32_t fsh_rt_json_int(fsh_json_in *r, __int128 *out, int32_t bits, int32_t is_signed, const char *what) {
  int32_t c = fsh_rt_json_peek(r);
  if (c != '-' && !(c >= '0' && c <= '9')) return fsh_json_wrong(r, what);
  int whole;
  int64_t bad, length = fsh_json_number(r, &whole, &bad);
  if (length == 0) {
    r->at = bad;
    return fsh_json_syntax(r);
  }
  const unsigned char *p = r->p + r->at;
  int negative = p[0] == '-', over = 0;
  unsigned __int128 magnitude = 0, all = ~(unsigned __int128)0;
  if (whole) {
    for (int64_t i = negative; i < length; i++) {
      unsigned d = p[i] - '0';
      if (magnitude > (all - d) / 10) over = 1;
      else magnitude = magnitude * 10 + d;
    }
  } else {
    double x = fsh_js_strtod(p, length);
    if (x != floor(x) || fabs(x) > 9007199254740992.0) over = 1;
    else magnitude = (unsigned __int128)fabs(x);
  }
  unsigned __int128 one = 1, top = bits == 128 ? all : (one << bits) - 1;
  unsigned __int128 limit = is_signed ? (negative ? one << (bits - 1) : (one << (bits - 1)) - 1) : negative ? 0 : top;
  if (over || magnitude > limit) {
    int64_t size = strlen(what) + r->path_length + length + 32;
    char *message = fsh_rt_alloc(size);
    snprintf(message, size, "%.*s doesn't fit %s at %.*s", (int)length, (const char *)p, what, (int)r->path_length, r->path);
    return fsh_json_error(r, message);
  }
  *out = negative ? (__int128)(0 - magnitude) : (__int128)magnitude;
  r->at += length;
  return 1;
}

int32_t fsh_rt_json_float(fsh_json_in *r, double *out, const char *what) {
  int32_t c = fsh_rt_json_peek(r);
  if (c != '-' && !(c >= '0' && c <= '9')) return fsh_json_wrong(r, what);
  int whole;
  int64_t bad, length = fsh_json_number(r, &whole, &bad);
  if (length == 0) {
    r->at = bad;
    return fsh_json_syntax(r);
  }
  *out = fsh_js_strtod(r->p + r->at, length);
  r->at += length;
  return 1;
}

static int fsh_json_hex(fsh_json_in *r, int64_t i, uint32_t *out) {
  if (r->n - i < 4) return 0;
  uint32_t v = 0;
  for (int64_t k = i; k < i + 4; k++) {
    unsigned char c = r->p[k];
    int d = c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1;
    if (d < 0) return 0;
    v = v * 16 + d;
  }
  *out = v;
  return 1;
}

// A string with its escapes decoded. An escaped pair of surrogates is one character, and a
// lone one stays a lone surrogate, as a JavaScript string may hold one.
int32_t fsh_rt_json_text(fsh_json_in *r, fsh_str **out, const char *what) {
  if (fsh_rt_json_peek(r) != '"') return fsh_json_wrong(r, what);
  char *bytes = fsh_rt_alloc(r->n - r->at + 1);
  int64_t length = 0, i = r->at + 1;
  for (;;) {
    if (i >= r->n) {
      r->at = i;
      fsh_rt_free(bytes);
      return fsh_json_syntax(r);
    }
    unsigned char c = r->p[i];
    if (c == '"') break;
    if (c < 0x20) {
      r->at = i;
      fsh_rt_free(bytes);
      return fsh_json_syntax(r);
    }
    if (c != '\\') {
      bytes[length++] = c;
      i++;
      continue;
    }
    unsigned char e = i + 1 < r->n ? r->p[i + 1] : 0;
    const char *simple = strchr("\"\\/bfnrt", e);
    if (e && simple) {
      bytes[length++] = "\"\\/\b\f\n\r\t"[simple - "\"\\/bfnrt"];
      i += 2;
      continue;
    }
    uint32_t code, low;
    if (e != 'u' || !fsh_json_hex(r, i + 2, &code)) {
      r->at = i + 1;
      fsh_rt_free(bytes);
      return fsh_json_syntax(r);
    }
    i += 6;
    if (code >= 0xD800 && code <= 0xDBFF && i + 1 < r->n && r->p[i] == '\\' && r->p[i + 1] == 'u' && fsh_json_hex(r, i + 2, &low) && low >= 0xDC00 && low <= 0xDFFF) {
      code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
      i += 6;
      bytes[length++] = 0xF0 | code >> 18;
      bytes[length++] = 0x80 | (code >> 12 & 0x3F);
      bytes[length++] = 0x80 | (code >> 6 & 0x3F);
      bytes[length++] = 0x80 | (code & 0x3F);
    } else length += fsh_put(bytes + length, code);
  }
  *out = fsh_str_of(bytes, length);
  fsh_rt_free(bytes);
  r->at = i + 1;
  return 1;
}

// Whether a string read is the given text, as a key or an enum member's name.
int32_t fsh_rt_json_same(fsh_str *s, const char *text, int64_t n) {
  return s->length == n && memcmp(s->bytes, text, n) == 0;
}

// Opens an array or an object, the bracket given.
int32_t fsh_rt_json_open(fsh_json_in *r, int32_t open, const char *what) {
  if (fsh_rt_json_peek(r) != open) return fsh_json_wrong(r, what);
  if (r->depth >= FSH_JSON_DEPTH) {
    char *message = fsh_rt_alloc(64);
    snprintf(message, 64, "JSON nested more than %d deep at position %lld", FSH_JSON_DEPTH, (long long)r->at);
    return fsh_json_error(r, message);
  }
  r->depth++;
  r->at++;
  return 1;
}

// Whether another element or field follows, past its comma when it isn't the first: 1 when
// one does, 0 when the closing bracket, now passed, ends it, and -1 on text that isn't JSON.
int32_t fsh_rt_json_more(fsh_json_in *r, int32_t close, int32_t first) {
  int32_t c = fsh_rt_json_peek(r);
  if (c == close && first) {
    r->at++;
    r->depth--;
    return 0;
  }
  if (!first) {
    if (c == close) {
      r->at++;
      r->depth--;
      return 0;
    }
    if (c != ',') return fsh_json_syntax(r) - 1;
    r->at++;
    if (fsh_rt_json_peek(r) == close) return fsh_json_syntax(r) - 1;
  }
  return 1;
}

// An object's key, with the colon after it.
int32_t fsh_rt_json_key(fsh_json_in *r, fsh_str **out) {
  if (fsh_rt_json_peek(r) != '"') return fsh_json_syntax(r);
  if (!fsh_rt_json_text(r, out, "a key")) return 0;
  if (fsh_rt_json_peek(r) != ':') {
    fsh_rt_str_release(*out);
    return fsh_json_syntax(r);
  }
  r->at++;
  return 1;
}

// Passes over a value of any kind, as a key nothing reads is.
int32_t fsh_rt_json_skip(fsh_json_in *r) {
  int32_t c = fsh_rt_json_peek(r);
  if (c == '"') {
    fsh_str *s;
    if (!fsh_rt_json_text(r, &s, "a string")) return 0;
    fsh_rt_str_release(s);
    return 1;
  }
  if (c == '{' || c == '[') {
    int32_t close = c == '{' ? '}' : ']';
    if (!fsh_rt_json_open(r, c, "a value")) return 0;
    for (int32_t first = 1;; first = 0) {
      int32_t more = fsh_rt_json_more(r, close, first);
      if (more <= 0) return more + 1;
      if (c == '{') {
        fsh_str *key;
        if (!fsh_rt_json_key(r, &key)) return 0;
        fsh_rt_str_release(key);
      }
      if (!fsh_rt_json_skip(r)) return 0;
    }
  }
  if ((c == 't' && fsh_json_word(r, "true", 4)) || (c == 'f' && fsh_json_word(r, "false", 5)) || (c == 'n' && fsh_json_word(r, "null", 4))) return 1;
  if (c == '-' || (c >= '0' && c <= '9')) {
    int whole;
    int64_t bad, length = fsh_json_number(r, &whole, &bad);
    if (length == 0) {
      r->at = bad;
      return fsh_json_syntax(r);
    }
    r->at += length;
    return 1;
  }
  return fsh_json_syntax(r);
}

// Nothing but white space left after the value.
int32_t fsh_rt_json_end(fsh_json_in *r) {
  if (fsh_rt_json_peek(r) < 0) return 1;
  char *message = fsh_rt_alloc(96);
  snprintf(message, 96, "Unexpected non-whitespace character after JSON at position %lld", (long long)r->at);
  return fsh_json_error(r, message);
}

// The os module, over libc. Each string is written to a buffer of the calling thread's,
// which the Fish side copies at once.
static __thread char fsh_os_text[4096];

const char *fsh_rt_os_hostname(void) {
  if (gethostname(fsh_os_text, sizeof fsh_os_text) != 0) fsh_os_text[0] = 0;
  fsh_os_text[sizeof fsh_os_text - 1] = 0;
  return fsh_os_text;
}

// TMPDIR, TMP or TEMP, else /tmp, without a trailing slash.
const char *fsh_rt_os_tmpdir(void) {
  const char *names[] = {"TMPDIR", "TMP", "TEMP"};
  const char *dir = NULL;
  for (int i = 0; i < 3 && (!dir || !*dir); i++) dir = getenv(names[i]);
  if (!dir || !*dir) dir = "/tmp";
  snprintf(fsh_os_text, sizeof fsh_os_text, "%s", dir);
  size_t n = strlen(fsh_os_text);
  if (n > 1 && fsh_os_text[n - 1] == '/') fsh_os_text[n - 1] = 0;
  return fsh_os_text;
}

// HOME, else the user's entry in the password database.
const char *fsh_rt_os_homedir(void) {
  const char *home = getenv("HOME");
  if (home && *home) {
    snprintf(fsh_os_text, sizeof fsh_os_text, "%s", home);
    return fsh_os_text;
  }
  struct passwd entry, *found = NULL;
  char buffer[4096];
  fsh_os_text[0] = 0;
  if (getpwuid_r(getuid(), &entry, buffer, sizeof buffer, &found) == 0 && found) snprintf(fsh_os_text, sizeof fsh_os_text, "%s", found->pw_dir);
  return fsh_os_text;
}

const char *fsh_rt_os_platform(void) {
#ifdef __APPLE__
  return "darwin";
#else
  return "linux";
#endif
}

const char *fsh_rt_os_arch(void) {
#if defined(__aarch64__) || defined(__arm64__)
  return "arm64";
#else
  return "x64";
#endif
}

// The CPUs this process may run on, at least one.
int64_t fsh_rt_os_parallelism(void) {
#ifdef __linux__
  cpu_set_t set;
  if (sched_getaffinity(0, sizeof set, &set) == 0) {
    int n = CPU_COUNT(&set);
    if (n > 0) return n;
  }
#endif
  long n = sysconf(_SC_NPROCESSORS_ONLN);
  return n > 0 ? n : 1;
}

// The program's arguments, kept from main for process.argv, which holds the runtime's
// path, the script's, then the arguments; a Fish program is both, so its path comes twice.
static int32_t fsh_argc = 0;
static char **fsh_argv = NULL;
static char fsh_exe[PATH_MAX];

void fsh_rt_args(int32_t argc, char **argv) {
  fsh_argc = argc;
  fsh_argv = argv;
  char found[PATH_MAX];
  int ok = 0;
#ifdef __APPLE__
  uint32_t size = sizeof found;
  ok = _NSGetExecutablePath(found, &size) == 0;
#else
  ssize_t n = readlink("/proc/self/exe", found, sizeof found - 1);
  if (n > 0) {
    found[n] = 0;
    ok = 1;
  }
#endif
  if (!ok || !realpath(found, fsh_exe)) {
    if (!argc || !realpath(argv[0], fsh_exe)) snprintf(fsh_exe, sizeof fsh_exe, "%s", argc ? argv[0] : "");
  }
}

int64_t fsh_rt_argc(void) {
  return fsh_argc + 1;
}

const char *fsh_rt_arg(int64_t i) {
  return i < 2 ? fsh_exe : fsh_argv[i - 1];
}

// The working directory, in the calling thread's buffer, as path.resolve starts from it. One the
// system can't give, deleted or too long, is a panic.
const char *fsh_rt_cwd(void) {
  if (getcwd(fsh_os_text, sizeof fsh_os_text)) return fsh_os_text;
  char message[256];
  snprintf(message, sizeof message, "the working directory can't be read: %s\n", strerror(errno));
  fsh_rt_panic(message);
  return NULL;
}

// For process.chdir: 0, or -errno for the IoError.
int64_t fsh_rt_chdir(const char *path) {
  return chdir(path) == 0 ? 0 : -errno;
}

const char *fsh_rt_getenv(const char *name) {
  return getenv(name);
}

// The environment's entries as "NAME=value", in the order the OS keeps them. Nothing in Fish
// changes the environment, so environ stays as it was read.
int64_t fsh_rt_env_count(void) {
  extern char **environ;
  int64_t n = 0;
  while (environ[n]) n++;
  return n;
}

const char *fsh_rt_env_at(int64_t i) {
  extern char **environ;
  return environ[i];
}

// Date.now(): the wall clock's milliseconds since the Unix epoch.
int64_t fsh_rt_date_now(void) {
  fsh_sim_init();
  if (fsh_sim_active) return FSH_SIM_EPOCH_MS + fsh_sim_now_ns / 1000000;
  struct timespec t;
  clock_gettime(CLOCK_REALTIME, &t);
  return (int64_t)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}

// The wall clock's nanoseconds since the Unix epoch, as OTLP writes a span's times.
int64_t fsh_rt_unix_nanos(void) {
  fsh_sim_init();
  if (fsh_sim_active) {
    int64_t base = FSH_SIM_EPOCH_MS * 1000000LL;
    return fsh_sim_now_ns > INT64_MAX - base ? INT64_MAX : base + fsh_sim_now_ns;
  }
  struct timespec t;
  clock_gettime(CLOCK_REALTIME, &t);
  return (int64_t)t.tv_sec * 1000000000 + t.tv_nsec;
}

// Fills count bytes from the OS's secure random source: arc4random_buf on macOS, which can't fail,
// and getrandom(2) on Linux, which blocks only until the pool is first seeded at boot.
void fsh_rt_random_fill(uint8_t *at, int64_t count) {
  fsh_sim_init();
  if (fsh_sim_active) {
    while (count > 0) {
      uint64_t w = fsh_sim_next_u64(fsh_sim_user_rng);
      int64_t n = count < 8 ? count : 8;
      memcpy(at, &w, (size_t)n);
      at += n;
      count -= n;
    }
    return;
  }
#ifdef __APPLE__
  arc4random_buf(at, (size_t)count);
#else
  while (count > 0) {
    ssize_t got = getrandom(at, (size_t)count, 0);
    if (got < 0) {
      if (errno == EINTR) continue;
      fsh_rt_panic("the OS's secure random source failed\n");
    }
    at += got;
    count -= got;
  }
#endif
}

static uint32_t fsh_rotl(uint32_t x, int n) { return (x << n) | (x >> (32 - n)); }
static uint32_t fsh_rotr(uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }

static void fsh_sha1_block(uint32_t *h, const uint8_t *p) {
  uint32_t w[80];
  for (int i = 0; i < 16; i++) w[i] = (uint32_t)p[4 * i] << 24 | (uint32_t)p[4 * i + 1] << 16 | (uint32_t)p[4 * i + 2] << 8 | p[4 * i + 3];
  for (int i = 16; i < 80; i++) w[i] = fsh_rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
  uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
  for (int i = 0; i < 80; i++) {
    uint32_t f, k;
    if (i < 20) f = (b & c) | (~b & d), k = 0x5A827999;
    else if (i < 40) f = b ^ c ^ d, k = 0x6ED9EBA1;
    else if (i < 60) f = (b & c) | (b & d) | (c & d), k = 0x8F1BBCDC;
    else f = b ^ c ^ d, k = 0xCA62C1D6;
    uint32_t t = fsh_rotl(a, 5) + f + e + k + w[i];
    e = d, d = c, c = fsh_rotl(b, 30), b = a, a = t;
  }
  h[0] += a, h[1] += b, h[2] += c, h[3] += d, h[4] += e;
}

static const uint32_t fsh_sha256_k[64] = {
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
};

static void fsh_sha256_block(uint32_t *h, const uint8_t *p) {
  uint32_t w[64];
  for (int i = 0; i < 16; i++) w[i] = (uint32_t)p[4 * i] << 24 | (uint32_t)p[4 * i + 1] << 16 | (uint32_t)p[4 * i + 2] << 8 | p[4 * i + 3];
  for (int i = 16; i < 64; i++) {
    uint32_t s0 = fsh_rotr(w[i - 15], 7) ^ fsh_rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
    uint32_t s1 = fsh_rotr(w[i - 2], 17) ^ fsh_rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
  for (int i = 0; i < 64; i++) {
    uint32_t t1 = hh + (fsh_rotr(e, 6) ^ fsh_rotr(e, 11) ^ fsh_rotr(e, 25)) + ((e & f) ^ (~e & g)) + fsh_sha256_k[i] + w[i];
    uint32_t t2 = (fsh_rotr(a, 2) ^ fsh_rotr(a, 13) ^ fsh_rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
    hh = g, g = f, f = e, e = d + t1, d = c, c = b, b = a, a = t1 + t2;
  }
  h[0] += a, h[1] += b, h[2] += c, h[3] += d, h[4] += e, h[5] += f, h[6] += g, h[7] += hh;
}

// FIPS 180-4's SHA-1 (which 1, 20 bytes into out) or SHA-256 (which 256, 32 bytes) of data. Kept
// here rather than in OpenSSL so that hashing links nothing and can't fail.
void fsh_rt_sha(int64_t which, const uint8_t *data, int64_t length, uint8_t *out) {
  uint32_t h[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
  int words = 8;
  void (*block)(uint32_t *, const uint8_t *) = fsh_sha256_block;
  if (which == 1) {
    uint32_t h1[5] = {0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0};
    memcpy(h, h1, sizeof h1);
    words = 5;
    block = fsh_sha1_block;
  }
  int64_t full = length / 64 * 64;
  for (int64_t i = 0; i < full; i += 64) block(h, data + i);
  uint8_t tail[128] = {0};
  int64_t rest = length - full;
  memcpy(tail, data + full, (size_t)rest);
  tail[rest] = 0x80;
  int64_t end = rest < 56 ? 64 : 128;
  uint64_t bits = (uint64_t)length * 8;
  for (int i = 0; i < 8; i++) tail[end - 1 - i] = (uint8_t)(bits >> (8 * i));
  for (int64_t i = 0; i < end; i += 64) block(h, tail + i);
  for (int i = 0; i < words; i++) {
    out[4 * i] = (uint8_t)(h[i] >> 24);
    out[4 * i + 1] = (uint8_t)(h[i] >> 16);
    out[4 * i + 2] = (uint8_t)(h[i] >> 8);
    out[4 * i + 3] = (uint8_t)h[i];
  }
}

// Standard input, read on the blocking pool: a pipe, a terminal and a redirected file all read
// alike, and stdin's flags stay as they are, since a terminal shares them with the shell and
// O_NONBLOCK on it would break the shell after the program exits. Every reader takes from one
// buffer, so lines and whole-input reads interleave without losing bytes. The unread bytes are
// those from start to len.
static pthread_mutex_t fsh_stdin_lock = PTHREAD_MUTEX_INITIALIZER;
static uint8_t *fsh_stdin_buf = NULL;
static size_t fsh_stdin_start = 0, fsh_stdin_len = 0, fsh_stdin_cap = 0;
static int fsh_stdin_eof = 0;

// Reads one more chunk onto the buffer; 0 once input has ended. An error reading ends it too.
static int fsh_stdin_fill(void) {
  if (fsh_stdin_eof) return 0;
  if (fsh_stdin_start > 0) {
    memmove(fsh_stdin_buf, fsh_stdin_buf + fsh_stdin_start, fsh_stdin_len - fsh_stdin_start);
    fsh_stdin_len -= fsh_stdin_start;
    fsh_stdin_start = 0;
  }
  if (fsh_stdin_cap - fsh_stdin_len < 65536) {
    fsh_stdin_cap = fsh_stdin_cap * 2 + 65536;
    fsh_stdin_buf = realloc(fsh_stdin_buf, fsh_stdin_cap);
    if (!fsh_stdin_buf) fsh_rt_panic("out of memory reading standard input\n");
  }
  for (;;) {
    ssize_t got = read(0, fsh_stdin_buf + fsh_stdin_len, fsh_stdin_cap - fsh_stdin_len);
    if (got < 0 && errno == EINTR) continue;
    // A stdin some other process left non-blocking: wait for it rather than spin.
    if (got < 0 && errno == EAGAIN) {
      struct pollfd p = { .fd = 0, .events = POLLIN };
      poll(&p, 1, -1);
      continue;
    }
    if (got <= 0) {
      fsh_stdin_eof = 1;
      return 0;
    }
    fsh_stdin_len += (size_t)got;
    return 1;
  }
}

// The next line's length with its newline, with whole 1 everything left, and with whole 2 what
// has arrived, waiting for a read when nothing has; -1 when nothing is left. Its bytes are copied
// to at and taken only when they fit in cap, so a caller whose buffer is too small asks again
// with one of the length given.
int64_t fsh_rt_stdin_take(uint8_t *at, int64_t cap, int64_t whole) {
  pthread_mutex_lock(&fsh_stdin_lock);
  size_t n = 0, seen = 0;
  for (;;) {
    if (whole == 2 && fsh_stdin_len > fsh_stdin_start) {
      n = fsh_stdin_len - fsh_stdin_start;
      break;
    }
    if (whole == 0) {
      uint8_t *from = fsh_stdin_buf + fsh_stdin_start;
      size_t left = fsh_stdin_len - fsh_stdin_start - seen;
      uint8_t *nl = left > 0 ? memchr(from + seen, '\n', left) : NULL;
      if (nl) {
        n = (size_t)(nl - from) + 1;
        break;
      }
      seen = fsh_stdin_len - fsh_stdin_start;
    }
    if (!fsh_stdin_fill()) {
      n = fsh_stdin_len - fsh_stdin_start;
      break;
    }
  }
  int64_t result = n == 0 ? -1 : (int64_t)n;
  if (n > 0 && (int64_t)n <= cap) {
    memcpy(at, fsh_stdin_buf + fsh_stdin_start, n);
    fsh_stdin_start += n;
  }
  pthread_mutex_unlock(&fsh_stdin_lock);
  return result;
}

// Math.random(): 53 random bits as a double in [0, 1), from words each thread reads in bulk.
static _Thread_local uint64_t fsh_random_words[64];
static _Thread_local int32_t fsh_random_left = 0;

double fsh_rt_math_random(void) {
  if (fsh_random_left == 0) {
    fsh_rt_random_fill((uint8_t *)fsh_random_words, sizeof fsh_random_words);
    fsh_random_left = 64;
  }
  return (double)(fsh_random_words[--fsh_random_left] >> 11) * 0x1.0p-53;
}

// performance.now(): milliseconds, with fractions, since the program started, from a clock that
// only goes forward.
static struct timespec fsh_started;

__attribute__((constructor)) static void fsh_start_clock(void) {
  clock_gettime(CLOCK_MONOTONIC, &fsh_started);
}

double fsh_rt_performance_now(void) {
  fsh_sim_init();
  if (fsh_sim_active) return (double)fsh_sim_now_ns / 1e6;
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (double)(t.tv_sec - fsh_started.tv_sec) * 1e3 + (double)(t.tv_nsec - fsh_started.tv_nsec) / 1e6;
}

// process.exit: output flushed and the process ended at once, so what is still
// alive isn't reported as leaked.
void fsh_rt_exit(int64_t code) {
  fflush(NULL);
  fsh_abandoned = 1;
  exit((int)code);
}

// A value to print as Node's util.inspect prints it: a tree codegen builds, laid out here by
// a port of Node's formatValue, reduceToSingleString and groupArrayElements, with its defaults:
// depth 2, a break length of 80, compact 3, 100 elements and 10000 characters at most.
enum { FSH_INSP_TEXT, FSH_INSP_STRING, FSH_INSP_OBJECT, FSH_INSP_ARRAY, FSH_INSP_MAP, FSH_INSP_SET, FSH_INSP_VARIANT };

typedef struct fsh_insp {
  int32_t kind;
  // A number's text, set once it is a number, as an array's grouping pads them to the right.
  int32_t numeric;
  // TEXT: what it prints as; STRING: its bytes, quoted where it isn't printed on its own;
  // OBJECT: a class's name, or empty; VARIANT: the member's name.
  char *text;
  int64_t length;
  // The fields' keys, for an OBJECT, and their lengths, as a dictionary's key may hold a NUL.
  char **keys;
  int64_t *lengths;
  // The parts: fields, elements, members, a Map's keys and values in turn, a member's values.
  struct fsh_insp **items;
  int64_t count, room;
  // An ARRAY's, Map's or Set's size, of which the first 100 are kept.
  int64_t size;
  // An Error's OBJECT, its text the bracketed header printed in place of its stack, and
  // what it is past the depth, its class's name bracketed.
  int32_t error;
  // An OBJECT whose bracketed keys are written as they are, unquoted and unescaped.
  int32_t shown;
  char *cut;
} fsh_insp;

static fsh_insp *fsh_insp_new(int32_t kind, const char *text, int64_t length) {
  fsh_insp *v = fsh_rt_alloc(sizeof(fsh_insp));
  memset(v, 0, sizeof *v);
  v->kind = kind;
  v->text = fsh_rt_alloc(length + 1);
  memcpy(v->text, text, length);
  v->text[length] = 0;
  v->length = length;
  return v;
}

static void fsh_insp_add_n(fsh_insp *v, fsh_insp *item, const char *key, int64_t n) {
  if (v->count == v->room) {
    int64_t room = v->room ? v->room * 2 : 4;
    fsh_insp **items = fsh_rt_alloc(room * sizeof(fsh_insp *));
    char **keys = fsh_rt_alloc(room * sizeof(char *));
    int64_t *lengths = fsh_rt_alloc(room * sizeof(int64_t));
    if (v->count) {
      memcpy(items, v->items, v->count * sizeof(fsh_insp *));
      memcpy(keys, v->keys, v->count * sizeof(char *));
      memcpy(lengths, v->lengths, v->count * sizeof(int64_t));
    }
    fsh_rt_free(v->items);
    fsh_rt_free(v->keys);
    fsh_rt_free(v->lengths);
    v->items = items;
    v->keys = keys;
    v->lengths = lengths;
    v->room = room;
  }
  v->items[v->count] = item;
  v->keys[v->count] = NULL;
  v->lengths[v->count] = 0;
  if (key) {
    v->keys[v->count] = fsh_rt_alloc(n + 1);
    memcpy(v->keys[v->count], key, n);
    v->keys[v->count][n] = 0;
    v->lengths[v->count] = n;
  }
  v->count++;
}

static void fsh_insp_add(fsh_insp *v, fsh_insp *item, const char *key) {
  fsh_insp_add_n(v, item, key, key ? (int64_t)strlen(key) : 0);
}

static void fsh_insp_free(fsh_insp *v) {
  for (int64_t i = 0; i < v->count; i++) {
    fsh_insp_free(v->items[i]);
    fsh_rt_free(v->keys[i]);
  }
  fsh_rt_free(v->items);
  fsh_rt_free(v->keys);
  fsh_rt_free(v->lengths);
  fsh_rt_free(v->text);
  fsh_rt_free(v->cut);
  fsh_rt_free(v);
}

fsh_insp *fsh_rt_insp_text(const char *text) {
  return fsh_insp_new(FSH_INSP_TEXT, text, strlen(text));
}

// A bigint as console.log shows one, its digits then 'n'.
fsh_insp *fsh_rt_insp_bigint(const struct fsh_big *n) {
  fsh_str *digits = fsh_rt_big_text(n, 10);
  char *text = fsh_rt_alloc(digits->length + 2);
  memcpy(text, digits->bytes, digits->length);
  text[digits->length] = 'n';
  fsh_insp *v = fsh_insp_new(FSH_INSP_TEXT, text, digits->length + 1);
  v->numeric = 1;
  fsh_rt_free(text);
  fsh_rt_str_release(digits);
  return v;
}

fsh_insp *fsh_rt_insp_i128(__int128 n) {
  char text[41];
  fsh_insp *v = fsh_insp_new(FSH_INSP_TEXT, text, fsh_i128_digits(n, text));
  v->numeric = 1;
  return v;
}

fsh_insp *fsh_rt_insp_u128(unsigned __int128 n) {
  char text[41];
  fsh_insp *v = fsh_insp_new(FSH_INSP_TEXT, text, fsh_digits128(n, 0, text));
  v->numeric = 1;
  return v;
}

fsh_insp *fsh_rt_insp_i64(int64_t n) {
  char text[24];
  fsh_insp *v = fsh_insp_new(FSH_INSP_TEXT, text, snprintf(text, sizeof text, "%lld", (long long)n));
  v->numeric = 1;
  return v;
}

fsh_insp *fsh_rt_insp_u64(uint64_t n) {
  char text[24];
  fsh_insp *v = fsh_insp_new(FSH_INSP_TEXT, text, snprintf(text, sizeof text, "%llu", (unsigned long long)n));
  v->numeric = 1;
  return v;
}

// A float as String(x) writes it, and -0 as -0.
fsh_insp *fsh_rt_insp_f64(double x, int32_t single) {
  char text[40];
  if (x == 0 && signbit(x)) strcpy(text, "-0");
  else fsh_format(x, single, text);
  fsh_insp *v = fsh_insp_new(FSH_INSP_TEXT, text, strlen(text));
  v->numeric = 1;
  return v;
}

fsh_insp *fsh_rt_insp_string(fsh_str *s) {
  return fsh_insp_new(FSH_INSP_STRING, s->bytes, s->length);
}

// Text printed as it is, unquoted, which it takes over.
fsh_insp *fsh_rt_insp_raw(fsh_str *s) {
  fsh_insp *v = fsh_insp_new(FSH_INSP_TEXT, s->bytes, s->length);
  fsh_rt_str_release(s);
  return v;
}

fsh_insp *fsh_rt_insp_object(const char *name) {
  return fsh_insp_new(FSH_INSP_OBJECT, name, strlen(name));
}

void fsh_rt_insp_field(fsh_insp *object, const char *key, fsh_insp *value) {
  fsh_insp_add(object, value, key);
}

// A dictionary's entry, its key known only at run time.
void fsh_rt_insp_entry(fsh_insp *object, fsh_str *key, fsh_insp *value) {
  fsh_insp_add_n(object, value, key->bytes, key->length);
}

fsh_insp *fsh_rt_insp_list(int32_t kind, int64_t size) {
  fsh_insp *v = fsh_insp_new(kind, "", 0);
  v->size = size;
  return v;
}

// An element, member, key or value; those past the first 100 are dropped and
// counted as how many more there are.
void fsh_rt_insp_push(fsh_insp *list, fsh_insp *item) {
  int64_t limit = list->kind == FSH_INSP_MAP ? 200 : list->kind == FSH_INSP_VARIANT ? INT64_MAX : 100;
  if (list->count >= limit) fsh_insp_free(item);
  else fsh_insp_add(list, item, NULL);
}

// A list's elements moved onto the end of another, as a rest tuple's array joins its fixed elements.
void fsh_rt_insp_append(fsh_insp *list, fsh_insp *more) {
  list->size += more->size;
  for (int64_t i = 0; i < more->count; i++) fsh_rt_insp_push(list, more->items[i]);
  more->count = 0;
  fsh_insp_free(more);
}

// A Map or Set a class extending one embeds, printed under the class's name; the class's own
// fields follow its entries, keyed.
void fsh_rt_insp_named(fsh_insp *v, const char *name) {
  fsh_rt_free(v->text);
  v->length = strlen(name);
  v->text = fsh_rt_alloc(v->length + 1);
  memcpy(v->text, name, v->length + 1);
}

fsh_insp *fsh_rt_insp_variant(const char *name) {
  return fsh_insp_new(FSH_INSP_VARIANT, name, strlen(name));
}

// Text being built, NUL-terminated.
typedef struct {
  char *p;
  int64_t n, room;
} fsh_sb;

static void fsh_sb_put(fsh_sb *b, const char *p, int64_t n) {
  if (b->n + n + 1 > b->room) {
    int64_t room = b->room ? b->room * 2 : 64;
    while (room < b->n + n + 1) room *= 2;
    char *grown = fsh_rt_alloc(room);
    if (b->n) memcpy(grown, b->p, b->n);
    fsh_rt_free(b->p);
    b->p = grown;
    b->room = room;
  }
  memcpy(b->p + b->n, p, n);
  b->n += n;
  b->p[b->n] = 0;
}

static void fsh_sb_str(fsh_sb *b, const char *s) {
  fsh_sb_put(b, s, strlen(s));
}

static void fsh_sb_spaces(fsh_sb *b, int64_t n) {
  for (int64_t i = 0; i < n; i++) fsh_sb_put(b, " ", 1);
}

static char *fsh_sb_done(fsh_sb *b) {
  if (!b->p) fsh_sb_put(b, "", 0);
  return b->p;
}

// An ArrayBuffer: its first 100 bytes in hex, then its length.
fsh_insp *fsh_rt_insp_buffer(const uint8_t *data, int64_t length) {
  fsh_insp *v = fsh_rt_insp_object("ArrayBuffer");
  v->shown = 1;
  fsh_sb b = {0};
  fsh_sb_str(&b, "<");
  for (int64_t i = 0; i < length && i < 100; i++) {
    char hex[4];
    snprintf(hex, sizeof hex, i > 0 ? " %02x" : "%02x", data[i]);
    fsh_sb_str(&b, hex);
  }
  if (length > 100) {
    char more[64];
    snprintf(more, sizeof more, " ... %lld more byte%s", (long long)(length - 100), length > 101 ? "s" : "");
    fsh_sb_str(&b, more);
  }
  fsh_sb_str(&b, ">");
  char *contents = fsh_sb_done(&b);
  fsh_insp_add(v, fsh_rt_insp_text(contents), "[Uint8Contents]");
  fsh_rt_free(contents);
  fsh_insp_add(v, fsh_rt_insp_i64(length), "byteLength");
  return v;
}

// A Buffer at any depth: its first 50 bytes in hex, then how many more.
fsh_insp *fsh_rt_insp_node_buffer(const uint8_t *data, int64_t length) {
  fsh_sb b = {0};
  fsh_sb_str(&b, "<Buffer ");
  for (int64_t i = 0; i < length && i < 50; i++) {
    char hex[4];
    snprintf(hex, sizeof hex, i > 0 ? " %02x" : "%02x", data[i]);
    fsh_sb_str(&b, hex);
  }
  if (length > 50) {
    char more[64];
    snprintf(more, sizeof more, " ... %lld more byte%s", (long long)(length - 50), length > 51 ? "s" : "");
    fsh_sb_str(&b, more);
  }
  fsh_sb_str(&b, ">");
  char *text = fsh_sb_done(&b);
  fsh_insp *v = fsh_insp_new(FSH_INSP_TEXT, text, strlen(text));
  fsh_rt_free(text);
  return v;
}

// An Error with no stack lines: its name and message, the class's name when
// it differs and the error's name ends in Error, bracketed.
fsh_insp *fsh_rt_insp_error(const char *cls, fsh_str *name, fsh_str *message) {
  fsh_sb b = {0};
  fsh_sb_str(&b, "[");
  int64_t n = name->length;
  int differs = cls[0] && ((int64_t)strlen(cls) != n || memcmp(cls, name->bytes, n) != 0);
  int named = n >= 5 && memcmp(name->bytes + n - 5, "Error", 5) == 0;
  if (differs && named) {
    fsh_sb_str(&b, cls);
    // A class whose name holds the error's takes its place; any other is written before it.
    char *own = fsh_rt_alloc(n + 1);
    memcpy(own, name->bytes, n);
    own[n] = 0;
    if (!strstr(cls, own)) {
      fsh_sb_str(&b, " [");
      fsh_sb_put(&b, name->bytes, n);
      fsh_sb_str(&b, "]");
    }
    fsh_rt_free(own);
  } else fsh_sb_put(&b, name->bytes, n);
  // As V8's ErrorUtils::ToString: an empty name or message leaves the colon out.
  if (message->length > 0) {
    if (b.n > 1) fsh_sb_str(&b, ": ");
    fsh_sb_put(&b, message->bytes, message->length);
  }
  fsh_sb_str(&b, "]");
  fsh_insp *v = fsh_insp_new(FSH_INSP_OBJECT, b.p, b.n);
  fsh_rt_free(b.p);
  v->error = 1;
  fsh_sb cut = {0};
  fsh_sb_str(&cut, "[");
  if (cls[0]) fsh_sb_str(&cut, cls);
  else fsh_sb_put(&cut, name->bytes, n);
  fsh_sb_str(&cut, "]");
  v->cut = fsh_sb_done(&cut);
  return v;
}

// A UTF-8 text's length in UTF-16 units, as JavaScript counts a string, which the layout
// measures with.
static int64_t fsh_units(const char *p, int64_t n) {
  int64_t units = 0;
  for (int64_t i = 0; i < n; i++) {
    unsigned char c = p[i];
    if ((c & 0xC0) != 0x80) units += c >= 0xF0 ? 2 : 1;
  }
  return units;
}

static int64_t fsh_ulen(const char *s) {
  return fsh_units(s, strlen(s));
}

// The code point at p, moving p past it.
static uint32_t fsh_insp_cp(const unsigned char **p, const unsigned char *end) {
  const unsigned char *s = *p;
  uint32_t c = s[0];
  int n = c < 0x80 ? 1 : c < 0xE0 ? 2 : c < 0xF0 ? 3 : 4;
  if (s + n > end) n = end - s;
  if (n == 2) c = (c & 0x1F) << 6 | (s[1] & 0x3F);
  else if (n == 3) c = (c & 0x0F) << 12 | (s[1] & 0x3F) << 6 | (s[2] & 0x3F);
  else if (n == 4) c = (c & 0x07) << 18 | (s[1] & 0x3F) << 12 | (s[2] & 0x3F) << 6 | (s[3] & 0x3F);
  *p = s + n;
  return c;
}

// Columns a text takes, by Node's tables for builds without ICU.
// ponytail: East Asian width from Node's fallback table, not ICU's; switch to ICU data if grouped
// arrays of wide text must line up as Node's ICU build lines them
static int64_t fsh_insp_width(const char *text) {
  const unsigned char *p = (const unsigned char *)text, *end = p + strlen(text);
  int64_t width = 0;
  while (p < end) {
    uint32_t c = fsh_insp_cp(&p, end);
    int full = c >= 0x1100 && (c <= 0x115f || c == 0x2329 || c == 0x232a || (c >= 0x2e80 && c <= 0x3247 && c != 0x303f) || (c >= 0x3250 && c <= 0x4dbf) || (c >= 0x4e00 && c <= 0xa4c6) || (c >= 0xa960 && c <= 0xa97c) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe10 && c <= 0xfe19) || (c >= 0xfe30 && c <= 0xfe6b) || (c >= 0xff01 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1b000 && c <= 0x1b001) || (c >= 0x1f200 && c <= 0x1f251) || (c >= 0x1f300 && c <= 0x1f64f) || (c >= 0x20000 && c <= 0x3fffd));
    int zero = c <= 0x1F || (c >= 0x7F && c <= 0x9F) || (c >= 0x300 && c <= 0x36F) || (c >= 0x200B && c <= 0x200F) || (c >= 0x20D0 && c <= 0x20FF) || (c >= 0xFE00 && c <= 0xFE0F) || (c >= 0xFE20 && c <= 0xFE2F) || (c >= 0xE0100 && c <= 0xE01EF);
    width += full ? 2 : zero ? 0 : 1;
  }
  return width;
}

// Node's strEscape: single quotes unless the text holds one, then double quotes, then
// backticks; control characters, the quote and backslashes escaped, a lone surrogate by its hex.
static void fsh_insp_quote(fsh_sb *b, const char *p, int64_t n) {
  int quote = '\'';
  if (memchr(p, '\'', n)) {
    int doubles = memchr(p, '"', n) != NULL, ticks = memchr(p, 96, n) != NULL;
    int splice = 0;
    for (int64_t i = 0; i + 1 < n; i++) if (p[i] == '$' && p[i + 1] == '{') splice = 1;
    if (!doubles) quote = '"';
    else if (!ticks && !splice) quote = 96;
  }
  char q = (char)quote;
  fsh_sb_put(b, &q, 1);
  const unsigned char *s = (const unsigned char *)p;
  for (int64_t i = 0; i < n;) {
    unsigned char c = s[i];
    char escape[12];
    if (c == quote && quote == '\'') { fsh_sb_str(b, "\\'"); i++; continue; }
    if (c == '\\') { fsh_sb_str(b, "\\\\"); i++; continue; }
    if (c < 0x20 || c == 0x7F) {
      const char *named = c == '\b' ? "\\b" : c == '\t' ? "\\t" : c == '\n' ? "\\n" : c == '\f' ? "\\f" : c == '\r' ? "\\r" : NULL;
      if (named) fsh_sb_str(b, named);
      else {
        snprintf(escape, sizeof escape, "\\x%02X", c);
        fsh_sb_str(b, escape);
      }
      i++;
      continue;
    }
    // C1 controls, U+0080 to U+009F, are C2 80 to C2 9F in UTF-8.
    if (c == 0xC2 && i + 1 < n && s[i + 1] >= 0x80 && s[i + 1] <= 0x9F) {
      snprintf(escape, sizeof escape, "\\x%02X", s[i + 1]);
      fsh_sb_str(b, escape);
      i += 2;
      continue;
    }
    if (i + 2 < n && (fsh_high_at(s + i) || fsh_low_at(s + i))) {
      snprintf(escape, sizeof escape, "\\" "u%x", fsh_three(s + i));
      fsh_sb_str(b, escape);
      i += 3;
      continue;
    }
    fsh_sb_put(b, (const char *)s + i, 1);
    i++;
  }
  fsh_sb_put(b, &q, 1);
}

typedef struct {
  int64_t indent, depth;
  // Node's showHidden, which util.format's %o turns on: an array also shows its [length].
  int hidden;
} fsh_ictx;

static char *fsh_insp_value(fsh_ictx *c, fsh_insp *v, int64_t recurse);

// A string inside a value: quoted, cut past 10000 characters, and split after each line break
// when it is longer than the line has room for.
static char *fsh_insp_string(fsh_ictx *c, fsh_insp *v) {
  fsh_sb b = {0};
  int64_t units = fsh_units(v->text, v->length), n = v->length;
  int64_t remaining = 0;
  if (units > 10000) {
    remaining = units - 10000;
    int64_t seen = 0, i = 0;
    for (; i < v->length && seen < 10000; i++) {
      unsigned char ch = v->text[i];
      if ((ch & 0xC0) != 0x80) seen += ch >= 0xF0 ? 2 : 1;
    }
    while (i < v->length && ((unsigned char)v->text[i] & 0xC0) == 0x80) i++;
    n = i;
    units = 10000;
  }
  if (units > 16 && units > 80 - c->indent - 4) {
    int64_t from = 0;
    for (int64_t i = 0; i < n; i++) {
      if (v->text[i] != '\n' && i != n - 1) continue;
      if (from > 0) {
        fsh_sb_str(&b, " +\n");
        fsh_sb_spaces(&b, c->indent + 2);
      }
      fsh_insp_quote(&b, v->text + from, i + 1 - from);
      from = i + 1;
    }
  } else fsh_insp_quote(&b, v->text, n);
  if (remaining > 0) {
    char trailer[64];
    snprintf(trailer, sizeof trailer, "... %lld more character%s", (long long)remaining, remaining > 1 ? "s" : "");
    fsh_sb_str(&b, trailer);
  }
  return fsh_sb_done(&b);
}

static int fsh_insp_below(char **output, int64_t n, int64_t start) {
  int64_t total = n + start;
  if (total + n > 80) return 0;
  for (int64_t i = 0; i < n; i++) {
    total += fsh_ulen(output[i]);
    if (total > 80) return 0;
  }
  return 1;
}

// Node's groupArrayElements: short entries of a long array in aligned columns. Gives the
// number of lines written to grouped, or 0 when the entries stay as they are.
static int64_t fsh_insp_group(fsh_ictx *c, char **output, int64_t n, int more, int numeric, char **grouped) {
  int64_t length = more ? n - 1 : n;
  int64_t total = 0, max = 0;
  int64_t *widths = fsh_rt_alloc((length + 1) * sizeof(int64_t));
  for (int64_t i = 0; i < length; i++) {
    widths[i] = fsh_insp_width(output[i]);
    total += widths[i] + 2;
    if (max < widths[i]) max = widths[i];
  }
  int64_t actual = max + 2, lines = 0;
  if (actual * 3 + c->indent < 80 && ((double)total / actual > 5 || max <= 6)) {
    double bias = sqrt(actual - (double)total / n);
    double biased = fmax(actual - 3 - bias, 1);
    double ideal = floor(sqrt(2.5 * biased * length) / biased + 0.5);
    int64_t columns = (int64_t)ideal;
    int64_t fit = (80 - c->indent) / actual;
    if (fit < columns) columns = fit;
    // Node's limits: compact times four, and fifteen.
    if (12 < columns) columns = 12;
    if (columns > 1) {
      int64_t *widest = fsh_rt_alloc(columns * sizeof(int64_t));
      for (int64_t i = 0; i < columns; i++) {
        int64_t line = 0;
        for (int64_t j = i; j < length; j += columns)
          if (widths[j] > line) line = widths[j];
        widest[i] = line + 2;
      }
      for (int64_t i = 0; i < length; i += columns) {
        int64_t end = i + columns < length ? i + columns : length;
        fsh_sb b = {0};
        int64_t j = i;
        for (; j < end - 1; j++) {
          // Pads the entry and its comma to the column's width, in UTF-16 units as JavaScript pads.
          int64_t pad = widest[j - i] + fsh_ulen(output[j]) - widths[j] - (fsh_ulen(output[j]) + 2);
          if (numeric) fsh_sb_spaces(&b, pad);
          fsh_sb_str(&b, output[j]);
          fsh_sb_str(&b, ", ");
          if (!numeric) fsh_sb_spaces(&b, pad);
        }
        if (numeric) {
          int64_t pad = widest[j - i] + fsh_ulen(output[j]) - widths[j] - 2 - fsh_ulen(output[j]);
          fsh_sb_spaces(&b, pad);
        }
        fsh_sb_str(&b, output[j]);
        grouped[lines++] = fsh_sb_done(&b);
      }
      if (more) {
        size_t m = strlen(output[n - 1]);
        grouped[lines] = fsh_rt_alloc(m + 1);
        memcpy(grouped[lines++], output[n - 1], m + 1);
      }
      fsh_rt_free(widest);
    }
  }
  fsh_rt_free(widths);
  return lines;
}

// Node's reduceToSingleString: the entries on one line when they are few and short enough,
// else one to a line.
static char *fsh_insp_reduce(fsh_ictx *c, char **output, int64_t n, const char *open, const char *close, int array, int more, int numeric, int64_t recurse) {
  int64_t entries = n;
  char **lines = output;
  char **grouped = NULL;
  if (array && n > 6) {
    grouped = fsh_rt_alloc(n * sizeof(char *));
    int64_t made = fsh_insp_group(c, output, n, more, numeric, grouped);
    if (made > 0) {
      lines = grouped;
      n = made;
    }
  }
  fsh_sb b = {0};
  int done = 0;
  // A base of several lines, as an Error's header may be, never sits on one line with its parts.
  if (c->depth - recurse < 3 && entries == n && !strchr(open, '\n')) {
    int64_t start = n + c->indent + fsh_ulen(open) + 10;
    if (fsh_insp_below(lines, n, start)) {
      fsh_sb joined = {0};
      for (int64_t i = 0; i < n; i++) {
        if (i > 0) fsh_sb_str(&joined, ", ");
        fsh_sb_str(&joined, lines[i]);
      }
      char *text = fsh_sb_done(&joined);
      if (!strchr(text, '\n')) {
        fsh_sb_str(&b, open);
        fsh_sb_str(&b, " ");
        fsh_sb_str(&b, text);
        fsh_sb_str(&b, " ");
        fsh_sb_str(&b, close);
        done = 1;
      }
      fsh_rt_free(text);
    }
  }
  if (!done) {
    fsh_sb_str(&b, open);
    for (int64_t i = 0; i < n; i++) {
      if (i > 0) fsh_sb_str(&b, ",");
      fsh_sb_str(&b, "\n");
      fsh_sb_spaces(&b, c->indent + 2);
      fsh_sb_str(&b, lines[i]);
    }
    fsh_sb_str(&b, "\n");
    fsh_sb_spaces(&b, c->indent);
    fsh_sb_str(&b, close);
  }
  if (grouped && lines == grouped)
    for (int64_t i = 0; i < n; i++) fsh_rt_free(grouped[i]);
  fsh_rt_free(grouped);
  return fsh_sb_done(&b);
}

static int fsh_insp_identifier(const char *key) {
  if (!((key[0] >= 'a' && key[0] <= 'z') || (key[0] >= 'A' && key[0] <= 'Z') || key[0] == '_')) return 0;
  for (const char *p = key + 1; *p; p++)
    if (!((*p >= 'a' && *p <= 'z') || (*p >= 'A' && *p <= 'Z') || (*p >= '0' && *p <= '9') || *p == '_')) return 0;
  return 1;
}

static char *fsh_insp_copy(const char *s) {
  fsh_sb b = {0};
  fsh_sb_str(&b, s);
  return fsh_sb_done(&b);
}

// A text with each line after its first indented by indent spaces.
static char *fsh_insp_indented(const char *text, int64_t indent) {
  fsh_sb b = {0};
  for (const char *p = text; *p; p++) {
    fsh_sb_put(&b, p, 1);
    if (*p == '\n') fsh_sb_spaces(&b, indent);
  }
  return fsh_sb_done(&b);
}

// Node's formatValue and formatRaw for the kinds Fish values have.
static char *fsh_insp_value(fsh_ictx *c, fsh_insp *v, int64_t recurse) {
  if (v->kind == FSH_INSP_TEXT) return fsh_insp_copy(v->text);
  if (v->kind == FSH_INSP_STRING) return fsh_insp_string(c, v);
  if (v->kind == FSH_INSP_VARIANT) {
    // A data enum's member, as Fish prints one: its name, then its values.
    fsh_sb b = {0};
    fsh_sb_str(&b, v->text);
    if (v->count > 0) {
      fsh_sb_str(&b, "(");
      c->indent += 2;
      for (int64_t i = 0; i < v->count; i++) {
        if (i > 0) fsh_sb_str(&b, ", ");
        char *part = fsh_insp_value(c, v->items[i], recurse);
        fsh_sb_str(&b, part);
        fsh_rt_free(part);
      }
      c->indent -= 2;
      fsh_sb_str(&b, ")");
    }
    return fsh_sb_done(&b);
  }
  const char *close = v->kind == FSH_INSP_ARRAY ? "]" : "}";
  int64_t size = v->kind == FSH_INSP_OBJECT ? v->count : v->size;
  // A named Map's or Set's fields, after its entries.
  int64_t fields = 0;
  if (v->kind == FSH_INSP_MAP || v->kind == FSH_INSP_SET)
    while (fields < v->count && v->keys[v->count - 1 - fields]) fields++;
  // An Error with nothing to show beside its header is its header; past the depth, its class.
  // A header of several lines is indented to where it is written.
  if (v->error && size == 0) return fsh_insp_indented(v->text, c->indent);
  if (v->error && recurse > 2) return fsh_insp_copy(v->cut);
  // On the heap, sized to the text, a class's name or an Error's header, which may be long.
  char *text = v->error ? fsh_insp_indented(v->text, c->indent) : fsh_insp_copy(v->text);
  int64_t room = strlen(text) + 40;
  char *open = fsh_rt_alloc(room), *cut = fsh_rt_alloc(room);
  if (v->kind == FSH_INSP_ARRAY && v->length) {
    // A typed array, under its name.
    snprintf(open, room, "%s(%lld) [", text, (long long)size);
    snprintf(cut, room, "[%s]", text);
  } else if (v->kind == FSH_INSP_ARRAY) {
    strcpy(open, "[");
    strcpy(cut, "[Array]");
  } else if (v->kind == FSH_INSP_OBJECT) {
    snprintf(open, room, "%s%s{", text, v->length ? " " : "");
    snprintf(cut, room, "[%s]", v->length ? text : "Object");
  } else {
    const char *kind = v->kind == FSH_INSP_MAP ? "Map" : "Set";
    if (v->length) {
      snprintf(open, room, "%s(%lld) [%s] {", text, (long long)size, kind);
      snprintf(cut, room, "[%s [%s]]", text, kind);
    } else {
      snprintf(open, room, "%s(%lld) {", kind, (long long)size);
      snprintf(cut, room, "[%s]", kind);
    }
  }
  fsh_rt_free(text);
  int hidden = c->hidden && v->kind == FSH_INSP_ARRAY;
  if ((size == 0 && fields == 0 && !hidden) || recurse > 2) {
    fsh_sb b = {0};
    if (recurse > 2 && !(size == 0 && fields == 0 && !hidden)) fsh_sb_str(&b, cut);
    else {
      fsh_sb_str(&b, open);
      fsh_sb_str(&b, close);
    }
    fsh_rt_free(open);
    fsh_rt_free(cut);
    return fsh_sb_done(&b);
  }
  recurse++;
  c->depth = recurse;
  int64_t kept = v->kind == FSH_INSP_MAP ? (v->count - fields) / 2 : v->count - fields;
  int64_t rest = size - kept;
  char **output = fsh_rt_alloc((kept + fields + 2) * sizeof(char *));
  int64_t n = 0;
  int numeric = 1;
  c->indent += 2;
  for (int64_t i = 0; i < kept; i++) {
    if (v->kind == FSH_INSP_MAP) {
      fsh_sb b = {0};
      char *k = fsh_insp_value(c, v->items[2 * i], recurse);
      char *x = fsh_insp_value(c, v->items[2 * i + 1], recurse);
      fsh_sb_str(&b, k);
      fsh_sb_str(&b, " => ");
      fsh_sb_str(&b, x);
      fsh_rt_free(k);
      fsh_rt_free(x);
      output[n++] = fsh_sb_done(&b);
      continue;
    }
    char *x = fsh_insp_value(c, v->items[i], recurse);
    if (!v->items[i]->numeric) numeric = 0;
    if (v->kind != FSH_INSP_OBJECT) {
      output[n++] = x;
      continue;
    }
    fsh_sb b = {0};
    const char *key = v->keys[i];
    // An Error's '[cause]' and '[errors]' are written unquoted, as keys shown in brackets are.
    int64_t length = v->lengths[i];
    // An own key named __proto__ is bracketed, so it reads apart from the prototype.
    if (length == 9 && strcmp(key, "__proto__") == 0) fsh_sb_str(&b, "['__proto__']");
    else if ((fsh_insp_identifier(key) && (int64_t)strlen(key) == length) || ((v->error || v->shown) && key[0] == '[')) fsh_sb_str(&b, key);
    else fsh_insp_quote(&b, key, length);
    fsh_sb_str(&b, ": ");
    fsh_sb_str(&b, x);
    fsh_rt_free(x);
    output[n++] = fsh_sb_done(&b);
  }
  c->indent -= 2;
  if (rest > 0) {
    char text[64];
    snprintf(text, sizeof text, "... %lld more item%s", (long long)rest, rest > 1 ? "s" : "");
    output[n++] = fsh_insp_copy(text);
  }
  c->indent += 2;
  for (int64_t i = v->count - fields; i < v->count; i++) {
    fsh_sb b = {0};
    if (fsh_insp_identifier(v->keys[i]) && (int64_t)strlen(v->keys[i]) == v->lengths[i]) fsh_sb_str(&b, v->keys[i]);
    else fsh_insp_quote(&b, v->keys[i], v->lengths[i]);
    fsh_sb_str(&b, ": ");
    char *x = fsh_insp_value(c, v->items[i], recurse);
    fsh_sb_str(&b, x);
    fsh_rt_free(x);
    output[n++] = fsh_sb_done(&b);
  }
  c->indent -= 2;
  // A hidden key comes after the elements; as the array is read at each entry's index, the
  // columns pad as text unless there are elements past the entries shown. Only an
  // entry past the 100th is kept out of them.
  if (hidden) {
    char text[64];
    snprintf(text, sizeof text, "[length]: %lld", (long long)size);
    output[n++] = fsh_insp_copy(text);
    if (size < n) numeric = 0;
  }
  char *result = fsh_insp_reduce(c, output, n, open, close, v->kind == FSH_INSP_ARRAY, n > 100, numeric, recurse);
  for (int64_t i = 0; i < n; i++) fsh_rt_free(output[i]);
  fsh_rt_free(output);
  fsh_rt_free(open);
  fsh_rt_free(cut);
  return result;
}

// The value as console.log prints it, the tree freed: a string on its own as it is, anything
// else laid out.
fsh_str *fsh_rt_insp_done(fsh_insp *v) {
  fsh_str *s;
  if (v->kind == FSH_INSP_STRING) s = fsh_str_of(v->text, v->length);
  else {
    fsh_ictx c = {0, 0, 0};
    char *text = fsh_insp_value(&c, v, 0);
    s = fsh_str_of(text, strlen(text));
    fsh_rt_free(text);
  }
  fsh_insp_free(v);
  return s;
}

// A tree laid out at an inspect depth. The default depth 2 starts at 0, so depth d starts
// at 2 - d, which the trees codegen builds are also cut by.
static char *fsh_insp_at(fsh_insp *v, int64_t depth, int hidden) {
  fsh_ictx c = {0, 0, hidden};
  return fsh_insp_value(&c, v, 2 - depth);
}

// Text being built for JavaScript's String(x) of a value with parts, which codegen writes in.
fsh_sb *fsh_rt_text_new(void) {
  fsh_sb *b = fsh_rt_alloc(sizeof(fsh_sb));
  memset(b, 0, sizeof *b);
  return b;
}

void fsh_rt_text_add(fsh_sb *b, fsh_str *s) { fsh_sb_put(b, s->bytes, s->length); }

void fsh_rt_text_raw(fsh_sb *b, const char *s) { fsh_sb_str(b, s); }

void fsh_rt_text_i128(fsh_sb *b, __int128 x) {
  char t[41];
  fsh_i128_digits(x, t);
  fsh_sb_str(b, t);
}

void fsh_rt_text_u128(fsh_sb *b, unsigned __int128 x) {
  char t[41];
  fsh_digits128(x, 0, t);
  fsh_sb_str(b, t);
}

void fsh_rt_text_i64(fsh_sb *b, int64_t x) {
  char t[32];
  snprintf(t, sizeof t, "%lld", (long long)x);
  fsh_sb_str(b, t);
}

void fsh_rt_text_u64(fsh_sb *b, int64_t x) {
  char t[32];
  snprintf(t, sizeof t, "%llu", (unsigned long long)x);
  fsh_sb_str(b, t);
}

void fsh_rt_text_f64(fsh_sb *b, double x) {
  char t[32];
  fsh_sb_str(b, fsh_format(x, 0, t));
}

void fsh_rt_text_f32(fsh_sb *b, float x) {
  char t[32];
  fsh_sb_str(b, fsh_format(x, 1, t));
}

fsh_str *fsh_rt_text_done(fsh_sb *b) {
  fsh_str *s = fsh_str_of(b->p ? b->p : "", b->n);
  fsh_rt_free(b->p);
  fsh_rt_free(b);
  return s;
}

// util.format's arguments as codegen describes them: a scalar's value, a string, or for a value
// with parts its String(x), as JavaScript writes it, and its inspect tree, each built only when a
// specifier may ask for it. A float's whole is 1 when it is an f32, written as one. A string is
// lent; the text and tree of a value with parts are the routine's to free.
// An integer too wide for 'whole', a 128-bit one or a bigint, is its exact digits in 'text'.
enum { FSH_FARG_STRING, FSH_FARG_INT, FSH_FARG_UINT, FSH_FARG_FLOAT, FSH_FARG_BOOL, FSH_FARG_NULL, FSH_FARG_PARTS, FSH_FARG_DIGITS, FSH_FARG_BIGINT };

typedef struct {
  int32_t kind;
  int64_t whole;
  double number;
  fsh_str *text;
  fsh_insp *tree;
} fsh_farg;

static void fsh_farg_number(fsh_sb *b, double x) {
  char t[32];
  fsh_sb_str(b, fsh_rt_format_f64(x, t));
}

// A scalar as console.log prints it on its own.
static void fsh_farg_plain(fsh_sb *b, fsh_farg *a) {
  char t[32];
  switch (a->kind) {
    case FSH_FARG_STRING: fsh_sb_put(b, a->text->bytes, a->text->length); break;
    case FSH_FARG_INT: snprintf(t, sizeof t, "%lld", (long long)a->whole); fsh_sb_str(b, t); break;
    case FSH_FARG_UINT: snprintf(t, sizeof t, "%llu", (unsigned long long)a->whole); fsh_sb_str(b, t); break;
    case FSH_FARG_FLOAT:
      if (a->whole) fsh_sb_str(b, fsh_rt_format_f32((float)a->number, t));
      else fsh_farg_number(b, a->number);
      break;
    case FSH_FARG_BOOL: fsh_sb_str(b, a->whole ? "true" : "false"); break;
    case FSH_FARG_DIGITS: fsh_sb_put(b, a->text->bytes, a->text->length); break;
    case FSH_FARG_BIGINT: fsh_sb_put(b, a->text->bytes, a->text->length); fsh_sb_str(b, "n"); break;
    default: fsh_sb_str(b, "null"); break;
  }
}

// An argument inspected at a depth: a string quoted, a value with parts laid out.
static void fsh_farg_inspect(fsh_sb *b, fsh_farg *a, int64_t depth, int hidden) {
  if (a->kind != FSH_FARG_STRING && a->kind != FSH_FARG_PARTS) {
    fsh_farg_plain(b, a);
    return;
  }
  fsh_insp *quoted = a->kind == FSH_FARG_STRING ? fsh_rt_insp_string(a->text) : NULL;
  char *text = fsh_insp_at(quoted ? quoted : a->tree, depth, hidden);
  fsh_sb_str(b, text);
  fsh_rt_free(text);
  if (quoted) fsh_insp_free(quoted);
}

// An argument as String(x) gives it, for parseInt and parseFloat to read.
static fsh_str *fsh_farg_string(fsh_farg *a) {
  if (a->kind == FSH_FARG_STRING || a->kind == FSH_FARG_PARTS) {
    fsh_rt_str_retain(a->text);
    return a->text;
  }
  fsh_sb b = {0};
  if (a->kind == FSH_FARG_FLOAT) {
    char t[32];
    fsh_sb_str(&b, fsh_format(a->number, (int)a->whole, t));
  } else fsh_farg_plain(&b, a);
  fsh_str *s = fsh_str_of(b.p, b.n);
  fsh_rt_free(b.p);
  return s;
}

// JavaScript's parseInt with no radix, as a double: digits after white space, a sign and '0x',
// NaN when none start the text, -0 for a negative zero.
static double fsh_js_parse_int(fsh_str *s) {
  const unsigned char *p = (const unsigned char *)s->bytes;
  int64_t n = s->length, i = fsh_js_skip(p, n);
  int negative = i < n && p[i] == '-';
  if (i < n && (p[i] == '-' || p[i] == '+')) i++;
  int hex = i + 1 < n && p[i] == '0' && (p[i + 1] == 'x' || p[i + 1] == 'X');
  if (hex) i += 2;
  int64_t start = i;
  double v = 0;
  if (hex) {
    for (; i < n && fsh_digit(p[i]) < 16; i++) v = v * 16 + fsh_digit(p[i]);
  } else {
    while (i < n && p[i] >= '0' && p[i] <= '9') i++;
    if (i > start) v = fsh_js_strtod(p + start, i - start);
  }
  if (i == start) return NAN;
  return negative ? -v : v;
}

// What %d, %i and %f write: Number(x), parseInt(String(x)) and parseFloat(String(x)), an
// integer written as Fish writes it.
static void fsh_farg_numeric(fsh_sb *b, fsh_farg *a, char spec) {
  // Node writes a bigint's %d and %i with its 'n', and %f as the number it reads.
  if (a->kind == FSH_FARG_INT || a->kind == FSH_FARG_UINT || a->kind == FSH_FARG_DIGITS || (a->kind == FSH_FARG_BIGINT && spec != 'f')) {
    fsh_farg_plain(b, a);
    return;
  }
  if (spec == 'd' && a->kind == FSH_FARG_FLOAT) {
    fsh_farg_plain(b, a);
    return;
  }
  double x = NAN;
  if (spec == 'd' && a->kind != FSH_FARG_STRING && a->kind != FSH_FARG_PARTS) {
    x = a->kind == FSH_FARG_BOOL ? (double)a->whole : 0;
  } else {
    fsh_str *text = a->kind == FSH_FARG_BIGINT ? (fsh_rt_str_retain(a->text), a->text) : fsh_farg_string(a);
    double read;
    if (spec == 'd') x = fsh_rt_parse_number(text, &read) ? read : NAN;
    else if (spec == 'f') x = fsh_rt_parse_float(text, &read) ? read : NAN;
    else x = fsh_js_parse_int(text);
    fsh_rt_str_release(text);
  }
  fsh_farg_number(b, x);
}

// The texts and trees described arguments hold.
static void fsh_fargs_free(fsh_farg *args, int64_t n) {
  for (int64_t i = 0; i < n; i++) {
    if (args[i].kind != FSH_FARG_PARTS && args[i].kind != FSH_FARG_DIGITS && args[i].kind != FSH_FARG_BIGINT) continue;
    if (args[i].text) fsh_rt_str_release(args[i].text);
    if (args[i].tree) fsh_insp_free(args[i].tree);
  }
}

// util.inspect: what %O writes.
fsh_str *fsh_rt_inspect(fsh_farg *a) {
  fsh_sb b = {0};
  fsh_farg_inspect(&b, a, 2, 0);
  fsh_fargs_free(a, 1);
  fsh_str *s = fsh_str_of(b.p ? b.p : "", b.n);
  fsh_rt_free(b.p);
  return s;
}

// A port of Node's formatWithOptionsInternal: with a string first and more after it, each
// specifier takes the next argument while one is left, %% is a percent sign, and any other letter stays as written; the
// arguments left are appended after spaces, strings as they are and anything else inspected.
// %j, JSON, isn't written yet, so it panics where the format was called rather than leave the
// arguments after it out of line.
fsh_str *fsh_rt_format(fsh_farg *args, int64_t n, const char *where) {
  fsh_sb b = {0};
  int64_t a = 0;
  const char *join = "";
  if (n > 1 && args[0].kind == FSH_FARG_STRING) {
    const char *f = args[0].text->bytes;
    int64_t length = args[0].text->length, last = 0;
    for (int64_t i = 0; i < length - 1; i++) {
      if (f[i] != '%') continue;
      char next = f[++i];
      if (next == '%') {
        fsh_sb_put(&b, f + last, i - last);
        last = i + 1;
        continue;
      }
      if (a + 1 == n || next == 0 || !strchr("sdifoOcj", next)) continue;
      if (next == 'j') {
        fsh_rt_free(b.p);
        fsh_fargs_free(args, n);
        fsh_panic_at(where);
        fsh_rt_panic("'%j' in a format isn't supported yet; pass 'JSON.stringify(x)' to '%s' instead\n");
      }
      fsh_farg *x = &args[++a];
      if (last != i - 1) fsh_sb_put(&b, f + last, i - 1 - last);
      if (next == 's') {
        if (x->kind == FSH_FARG_PARTS) fsh_farg_inspect(&b, x, 0, 0);
        else fsh_farg_plain(&b, x);
      } else if (next == 'o') fsh_farg_inspect(&b, x, 4, 1);
      else if (next == 'O') fsh_farg_inspect(&b, x, 2, 0);
      else if (next != 'c') fsh_farg_numeric(&b, x, next);
      last = i + 1;
    }
    if (last != 0) {
      a++;
      join = " ";
      if (last < length) fsh_sb_put(&b, f + last, length - last);
    }
  }
  for (; a < n; a++) {
    fsh_sb_str(&b, join);
    join = " ";
    if (args[a].kind == FSH_FARG_STRING) fsh_farg_plain(&b, &args[a]);
    else fsh_farg_inspect(&b, &args[a], 2, 0);
  }
  fsh_fargs_free(args, n);
  fsh_str *s = fsh_str_of(b.p ? b.p : "", b.n);
  fsh_rt_free(b.p);
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
  // Polled on the blocking pool rather than by a worker: a spawnBlocking call's task.
  int32_t blocking;
  int64_t refs;
  fsh_poll_fn poll;
  fsh_drop_fn drop;
  fsh_drop_fn drop_output;
  fsh_task *joiner;
  fsh_task *prev, *next;
  // The reason it panicked, when its outcome is 3.
  struct fsh_str *panic;
  int64_t frame_size;
  int64_t output_size;
  // In a debug build, the call that spawned it, which its backtraces end with: for a task std
  // spawned with none of the program's frames below, the call that spawned the task doing so.
  const char *spawned;
  // Task inspector metadata: immutable fields set before linking onto fsh_alive; polls and
  // awaiting* updated atomically on the worker polling this task.
  int64_t id;
  const char *name;
  const char *spawn_site;
  int64_t created_ns;
  int64_t polls;
  uint32_t wait_seq;
  const char *awaiting;
  const char *await_site;
  int64_t await_target;
  // The task group it was spawned into, which it holds a count on, and the glue that moves the
  // error it threw out of its output into the group, as the type the group's await throws.
  struct fsh_group *group;
  void (*fail)(void *output, void *error);
  // Its trace context: the two halves of a trace id, the current span's id and the trace's
  // flags, all zero outside any span. A task starts with a copy of its spawner's.
  int64_t trace[4];
  char memory[];
};

static int64_t fsh_now(void);
static int64_t fsh_next_task_id = 0;

static void *fsh_output(fsh_task *t) { return t->memory + t->frame_size; }

// Records what a task is about to park on, with the active user await site when frames are on.
// Uses an even/odd seqlock so concurrent snapshots never read a torn tuple across polls.
static void fsh_task_wait(fsh_task *t, const char *what, int64_t target) {
  if (!t) return;
  uint32_t seq = __atomic_load_n(&t->wait_seq, __ATOMIC_RELAXED);
  __atomic_store_n(&t->wait_seq, seq + 1, __ATOMIC_RELAXED);
  __atomic_thread_fence(__ATOMIC_RELEASE);
  const char *site = fsh_rt_frames ? fsh_rt_frames->site : NULL;
  __atomic_store_n(&t->await_site, site, __ATOMIC_RELAXED);
  __atomic_store_n(&t->await_target, target, __ATOMIC_RELAXED);
  __atomic_store_n(&t->awaiting, what, __ATOMIC_RELAXED);
  __atomic_store_n(&t->wait_seq, seq + 2, __ATOMIC_RELEASE);
}

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
static int64_t fsh_stopped = 0;
static pthread_cond_t fsh_left = PTHREAD_COND_INITIALIZER;
// The tasks not yet done, dropped when the runtime stops; and how the program ends.
static pthread_mutex_t fsh_alive_lock = PTHREAD_MUTEX_INITIALIZER;
static fsh_task *fsh_alive = NULL;
static pthread_cond_t fsh_finished = PTHREAD_COND_INITIALIZER;
static int32_t fsh_panicked = 0;
static fsh_task *fsh_main_task = NULL;
// The task this thread is polling, whose trace context is the current one; code that runs
// outside any task, as a program with no async main does, has the thread's own.
static _Thread_local fsh_task *fsh_current = NULL;
static _Thread_local int64_t fsh_trace_root[4];
// Set by the claim that starts the timer task, for the task its thread makes next: the timer
// task has no context, so a timer's callback starts a trace of its own, whichever span was
// current when the first timer was set.
static _Thread_local int32_t fsh_timeouts_starting = 0;
// The task running timers' callbacks, once one is set.
static fsh_task *fsh_timeouts_task = NULL;
// Blocking tasks not yet done, which the runtime's end can't drop while a pool thread may poll one.
static int64_t fsh_blocking_live = 0;
// Blocking tasks done whose pool thread is still letting go of them. The runtime's end waits for
// these, or the blocks that thread is about to free would be counted as leaks.
static int64_t fsh_blocking_ending = 0;

static int fsh_push_checked(fsh_queue *q, fsh_task *t, int check_stopping) {
  pthread_mutex_lock(&q->lock);
  if (check_stopping && __atomic_load_n(&fsh_stopping, __ATOMIC_ACQUIRE)) {
    pthread_mutex_unlock(&q->lock);
    return 0;
  }
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
  return 1;
}

static void fsh_push(fsh_queue *q, fsh_task *t) {
  (void)fsh_push_checked(q, t, 0);
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

static void fsh_pool_task(fsh_task *t);

static fsh_task **fsh_sim_ready = NULL;
static int64_t fsh_sim_ready_count = 0, fsh_sim_ready_cap = 0;

static void fsh_sim_ready_push(fsh_task *t) {
  if (fsh_sim_ready_count == fsh_sim_ready_cap) {
    int64_t cap = fsh_sim_ready_cap ? fsh_sim_ready_cap * 2 : 64;
    fsh_sim_ready = realloc(fsh_sim_ready, (size_t)cap * sizeof(fsh_task *));
    fsh_sim_ready_cap = cap;
  }
  fsh_sim_ready[fsh_sim_ready_count++] = t;
}

// Queues a task: on the waking worker's own queue, or from any other thread on the shared
// one, then lets a parked worker know. A blocking task goes to the blocking pool instead.
static void fsh_schedule(fsh_task *t) {
  if (fsh_sim_active) {
    fsh_sim_ready_push(t);
    return;
  }
  if (t->blocking) return fsh_pool_task(t);
  if (fsh_worker >= 0) fsh_push(&fsh_queues[fsh_worker], t);
  else if (!fsh_push_checked(&fsh_injected, t, 1)) return;
  pthread_mutex_lock(&fsh_park);
  __atomic_fetch_add(&fsh_queued, 1, __ATOMIC_RELAXED);
  pthread_cond_signal(&fsh_parked);
  pthread_mutex_unlock(&fsh_park);
}

struct fsh_group;
static void fsh_group_done(struct fsh_group *g, fsh_task *t, int32_t result);
void fsh_rt_group_release(struct fsh_group *g);

void fsh_task_release(fsh_task *t) {
  if (__atomic_sub_fetch(&t->refs, 1, __ATOMIC_ACQ_REL) > 0) return;
  if (t->outcome == 1 || t->outcome == 2) t->drop_output(fsh_output(t));
  fsh_rt_str_release(t->panic);
  fsh_rt_group_release(t->group);
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
// ran. Finished, its output is kept and whoever awaits it is woken. A panic in main, or in the
// timer task, ends the program; in a spawned task, it ends only that task, its frame dropped
// where it stopped and its reason kept for whoever awaits it, as tokio's tasks do.
static void fsh_run(fsh_task *t) {
  __atomic_store_n(&t->state, FSH_RUNNING, __ATOMIC_RELEASE);
  __atomic_fetch_add(&t->polls, 1, __ATOMIC_RELAXED);
  uint32_t seq = __atomic_load_n(&t->wait_seq, __ATOMIC_RELAXED);
  __atomic_store_n(&t->wait_seq, seq + 1, __ATOMIC_RELAXED);
  __atomic_thread_fence(__ATOMIC_RELEASE);
  __atomic_store_n(&t->await_site, NULL, __ATOMIC_RELAXED);
  __atomic_store_n(&t->await_target, 0, __ATOMIC_RELAXED);
  __atomic_store_n(&t->awaiting, NULL, __ATOMIC_RELAXED);
  __atomic_store_n(&t->wait_seq, seq + 2, __ATOMIC_RELEASE);
  // A task's stack starts at its own root, whoever polls it, and a panic it unwound with leaves
  // its frames behind for this reset to drop.
  fsh_frame *frames = fsh_rt_frames;
  const char *spawned = fsh_spawned_at;
  fsh_task *current = fsh_current;
  fsh_rt_frames = NULL;
  fsh_spawned_at = t->spawned;
  fsh_current = t;
  int32_t result = t->poll(t, t->memory);
  fsh_rt_frames = frames;
  fsh_spawned_at = spawned;
  fsh_current = current;
  if (result == 3 && (t == fsh_main_task || t == fsh_timeouts_task)) {
    pthread_mutex_lock(&fsh_alive_lock);
    fsh_panic_began = 1;
    fsh_panicked = 1;
    pthread_cond_broadcast(&fsh_finished);
    pthread_mutex_unlock(&fsh_alive_lock);
    return;
  }
  if (result == 3) {
    t->drop(t->memory);
    t->panic = fsh_rt_str_from_cstring(fsh_reason);
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
  if (t == fsh_main_task || t == fsh_timeouts_task) pthread_cond_broadcast(&fsh_finished);
  pthread_mutex_unlock(&fsh_alive_lock);
  // Before the joiner wakes, so a main that ends once it is woken sees this one done.
  int32_t blocking = t->blocking;
  if (blocking) {
    __atomic_add_fetch(&fsh_blocking_ending, 1, __ATOMIC_RELEASE);
    __atomic_sub_fetch(&fsh_blocking_live, 1, __ATOMIC_RELEASE);
  }
  if (t->group) fsh_group_done(t->group, t, result);
  if (joiner) {
    fsh_rt_wake(joiner);
    fsh_task_release(joiner);
  }
  fsh_task_release(t);
  if (blocking) __atomic_sub_fetch(&fsh_blocking_ending, 1, __ATOMIC_RELEASE);
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
#ifdef FSH_PROFILE
  int prof_slot = fsh_prof_register();
#endif
  // A stopping runtime runs nothing more, however much is queued.
  while (!__atomic_load_n(&fsh_stopping, __ATOMIC_ACQUIRE)) {
    fsh_task *t = fsh_next_task(fsh_worker);
    if (t) {
      fsh_run(t);
      continue;
    }
    pthread_mutex_lock(&fsh_park);
    while (__atomic_load_n(&fsh_queued, __ATOMIC_RELAXED) <= 0 && !__atomic_load_n(&fsh_stopping, __ATOMIC_ACQUIRE)) pthread_cond_wait(&fsh_parked, &fsh_park);
    pthread_mutex_unlock(&fsh_park);
  }
#ifdef FSH_PROFILE
  fsh_prof_unregister(prof_slot);
#endif
  pthread_mutex_lock(&fsh_park);
  fsh_stopped++;
  pthread_cond_broadcast(&fsh_left);
  pthread_mutex_unlock(&fsh_park);
  return NULL;
}

// A new task for a future's frame, which it takes over: alive, and with one more reference for
// whoever made it. Not yet queued.
static fsh_task *fsh_task_new(fsh_poll_fn poll, fsh_drop_fn drop, fsh_drop_fn drop_output, void *frame, int64_t frame_size, int64_t output_size, const char *name, const char *site, int32_t blocking) {
  fsh_task *t = fsh_rt_alloc(sizeof(fsh_task) + frame_size + output_size);
  memcpy(t->memory, frame, frame_size);
  t->frame_size = frame_size;
  t->output_size = output_size;
  t->poll = poll;
  t->drop = drop;
  t->drop_output = drop_output;
  t->outcome = 0;
  t->blocking = blocking;
  t->refs = 2;
  t->joiner = NULL;
  t->panic = NULL;
  t->group = NULL;
  t->fail = NULL;
  t->state = FSH_QUEUED;
  t->spawned = fsh_rt_frames ? fsh_rt_frames->site : fsh_spawned_at;
  t->id = __atomic_add_fetch(&fsh_next_task_id, 1, __ATOMIC_RELAXED);
  t->name = name ? name : "";
  t->spawn_site = site ? site : t->spawned;
  t->created_ns = fsh_now();
  t->polls = 0;
  t->wait_seq = 0;
  t->awaiting = NULL;
  t->await_site = NULL;
  t->await_target = 0;
  if (fsh_timeouts_starting) memset(t->trace, 0, sizeof t->trace);
  else memcpy(t->trace, fsh_current ? fsh_current->trace : fsh_trace_root, sizeof t->trace);
  fsh_timeouts_starting = 0;
  pthread_mutex_lock(&fsh_alive_lock);
  t->prev = NULL;
  t->next = fsh_alive;
  if (fsh_alive) fsh_alive->prev = t;
  fsh_alive = t;
  pthread_mutex_unlock(&fsh_alive_lock);
  return t;
}

// The same, queued.
fsh_task *fsh_rt_spawn(fsh_poll_fn poll, fsh_drop_fn drop, fsh_drop_fn drop_output, void *frame, int64_t frame_size, int64_t output_size, const char *name, const char *site) {
  fsh_task *t = fsh_task_new(poll, drop, drop_output, frame, frame_size, output_size, name, site, 0);
  fsh_schedule(t);
  return t;
}

// The same, every poll run on the blocking pool, so it may block or compute for long without
// holding up a worker.
fsh_task *fsh_rt_spawn_blocking(fsh_poll_fn poll, fsh_drop_fn drop, fsh_drop_fn drop_output, void *frame, int64_t frame_size, int64_t output_size, const char *name, const char *site) {
  fsh_task *t = fsh_task_new(poll, drop, drop_output, frame, frame_size, output_size, name, site, 1);
  __atomic_add_fetch(&fsh_blocking_live, 1, __ATOMIC_RELAXED);
  fsh_schedule(t);
  return t;
}

// The same, its first poll run here and now, as a JS callback's first part runs where it is
// called; the task is queued only if that poll waits.
fsh_task *fsh_rt_spawn_now(fsh_poll_fn poll, fsh_drop_fn drop, fsh_drop_fn drop_output, void *frame, int64_t frame_size, int64_t output_size, const char *name, const char *site) {
  fsh_task *t = fsh_task_new(poll, drop, drop_output, frame, frame_size, output_size, name, site, 0);
  fsh_run(t);
  return t;
}

// The current trace context, read and replaced whole. It is the polled task's, so only the
// thread polling that task touches it.
void fsh_rt_trace_get(int64_t *out) {
  memcpy(out, fsh_current ? fsh_current->trace : fsh_trace_root, sizeof fsh_trace_root);
}

void fsh_rt_trace_set(const int64_t *words) {
  memcpy(fsh_current ? fsh_current->trace : fsh_trace_root, words, sizeof fsh_trace_root);
}

// The environment and the random source under names only std's tracing declares: a std module
// declares the C functions it calls, and one name declared by both would be declared twice.
const char *fsh_rt_trace_env(const char *name) {
  return getenv(name);
}

void fsh_rt_trace_ids(int64_t *out, int64_t count) {
  fsh_rt_random_fill((uint8_t *)out, count * 8);
}

// Awaits a spawned task: when it is done, its poll result is copied to out, which then owns
// it, and its outcome given; until then the awaiting task is woken when it finishes. A task that
// panicked gives 3 and its reason through why, for 'join()'; awaited plainly, with why null, its
// awaiter panics in turn at at, as Rust's 'join().unwrap()' does.
int32_t fsh_rt_join(fsh_task *t, fsh_task *waiter, void *out, const char *at, fsh_str **why) {
  pthread_mutex_lock(&fsh_alive_lock);
  if (__atomic_load_n(&t->state, __ATOMIC_ACQUIRE) == FSH_DONE) {
    pthread_mutex_unlock(&fsh_alive_lock);
    int32_t outcome = t->outcome;
    if (outcome == 3 && why) {
      fsh_rt_str_retain(t->panic);
      *why = t->panic;
      return 3;
    }
    if (outcome == 3) {
      char reason[1100];
      int n = snprintf(reason, sizeof reason, "a task this awaited panicked: %.*s", (int)t->panic->length, t->panic->bytes);
      fsh_panic_at(at);
      fputs(reason, stderr);
      fsh_panic_reason(reason, n < (int)sizeof reason ? (size_t)n : sizeof reason - 1);
      fsh_rt_panic("\nawait 'handle.join()' to catch it as a TaskPanic instead\n");
    }
    memcpy(out, fsh_output(t), t->output_size);
    t->outcome = 0;
    return outcome;
  }
  if (t->joiner != waiter) {
    __atomic_fetch_add(&waiter->refs, 1, __ATOMIC_RELAXED);
    t->joiner = waiter;
  }
  int64_t target_id = t->id;
  pthread_mutex_unlock(&fsh_alive_lock);
  fsh_task_wait(waiter, "join", target_id);
  return 0;
}

// Timers: a heap of deadlines, earliest first, and a thread that wakes each task when its
// deadline passes. Each entry holds a reference to its task.
// A timer wakes a sleeping task, or with a signal, aborts it for 'AbortSignal.timeout'.
// A sleep's timer is tagged with the sleep's frame, so cancelling one leaves its task's others.
typedef struct { int64_t deadline; uint64_t seq; fsh_task *task; struct fsh_signal *signal; void *tag; } fsh_timer;
void fsh_rt_signal_abort(struct fsh_signal *s);
void fsh_rt_signal_release(struct fsh_signal *s);
static pthread_mutex_t fsh_timer_lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t fsh_timer_changed = PTHREAD_COND_INITIALIZER;
static fsh_timer *fsh_timers = NULL;
static int64_t fsh_timer_count = 0, fsh_timer_capacity = 0;
static uint64_t fsh_timer_seq = 0;
static int32_t fsh_timers_stopping = 0;
static pthread_t fsh_timer_thread;

static int64_t fsh_now(void) {
  fsh_sim_init();
  if (fsh_sim_active) return fsh_sim_now_ns;
  struct timespec now;
  clock_gettime(CLOCK_MONOTONIC, &now);
  return (int64_t)now.tv_sec * 1000000000 + now.tv_nsec;
}

static int fsh_timer_before(fsh_timer a, fsh_timer b) {
  return a.deadline < b.deadline || (a.deadline == b.deadline && a.seq < b.seq);
}

static void fsh_timer_swap(int64_t a, int64_t b) {
  fsh_timer t = fsh_timers[a];
  fsh_timers[a] = fsh_timers[b];
  fsh_timers[b] = t;
}

static void fsh_timer_add(int64_t deadline, fsh_task *task, struct fsh_signal *signal, void *tag) {
  pthread_mutex_lock(&fsh_timer_lock);
  if (fsh_timer_count == fsh_timer_capacity) {
    fsh_timer_capacity = fsh_timer_capacity ? fsh_timer_capacity * 2 : 64;
    fsh_timers = realloc(fsh_timers, fsh_timer_capacity * sizeof(fsh_timer));
  }
  int64_t at = fsh_timer_count++;
  fsh_timers[at] = (fsh_timer){ deadline, ++fsh_timer_seq, task, signal, tag };
  while (at > 0 && fsh_timer_before(fsh_timers[at], fsh_timers[(at - 1) / 2])) {
    fsh_timer_swap(at, (at - 1) / 2);
    at = (at - 1) / 2;
  }
  if (!fsh_sim_active) pthread_cond_signal(&fsh_timer_changed);
  pthread_mutex_unlock(&fsh_timer_lock);
}

static fsh_timer fsh_timer_take(void) {
  fsh_timer taken = fsh_timers[0];
  fsh_timers[0] = fsh_timers[--fsh_timer_count];
  for (int64_t at = 0;;) {
    int64_t least = at, left = at * 2 + 1, right = left + 1;
    if (left < fsh_timer_count && fsh_timer_before(fsh_timers[left], fsh_timers[least])) least = left;
    if (right < fsh_timer_count && fsh_timer_before(fsh_timers[right], fsh_timers[least])) least = right;
    if (least == at) break;
    fsh_timer_swap(at, least);
    at = least;
  }
  return taken;
}

// Takes the timer at a place in the heap out of it, under the timers' lock.
static void fsh_timer_remove(int64_t at) {
  fsh_timers[at] = fsh_timers[--fsh_timer_count];
  while (at > 0 && fsh_timer_before(fsh_timers[at], fsh_timers[(at - 1) / 2])) {
    fsh_timer_swap(at, (at - 1) / 2);
    at = (at - 1) / 2;
  }
  for (;;) {
    int64_t least = at, left = at * 2 + 1, right = left + 1;
    if (left < fsh_timer_count && fsh_timer_before(fsh_timers[left], fsh_timers[least])) least = left;
    if (right < fsh_timer_count && fsh_timer_before(fsh_timers[right], fsh_timers[least])) least = right;
    if (least == at) break;
    fsh_timer_swap(at, least);
    at = least;
  }
}

// Takes the timer task set with tag off the heap, if it is there, giving up its count on the task;
// a sleep's state, when given, is marked cancelled under the timers' lock. A tag that isn't a
// sleep's frame, as a connect attempt's socket, has no state to mark.
static void fsh_timer_cancel(fsh_task *task, void *tag, int32_t *state) {
  pthread_mutex_lock(&fsh_timer_lock);
  int64_t at = 0;
  while (at < fsh_timer_count && (fsh_timers[at].task != task || fsh_timers[at].tag != tag)) at++;
  if (at == fsh_timer_count) return (void)pthread_mutex_unlock(&fsh_timer_lock);
  fsh_timer_remove(at);
  if (state) *state = 2;
  pthread_mutex_unlock(&fsh_timer_lock);
  fsh_task_release(task);
}

// An aborted or cancelled sleep takes its timer off the heap, so it neither waits out its deadline
// holding the task nor wakes it later; one never polled has none. Its state marks it cancelled, so
// an async generator paused on it, polled again, re-arms its timer for the same deadline.
// ponytail: an O(n) search for the entry, a handle kept in the frame if timer heaps grow large
void fsh_rt_sleep_cancel(fsh_task *task, void *frame) {
  fsh_timer_cancel(task, frame, frame);
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

// The callbacks setTimeout and setInterval set, earliest first and ties in the order set, which
// the prelude's one timer task runs in turn. Each holds its callable's block and vtable.
// ponytail: a sorted array, inserted into in O(n); a heap if programs keep many timers
// weak: a timer that runs while the program does but doesn't keep it running, as an unref'd one.
typedef struct { int64_t deadline, id, every; void *block; void **vtable; int32_t weak; } fsh_timeout;
static pthread_mutex_t fsh_timeouts_lock = PTHREAD_MUTEX_INITIALIZER;
static fsh_timeout *fsh_timeouts = NULL;
static int64_t fsh_timeout_count = 0, fsh_timeout_capacity = 0, fsh_timeout_ids = 0;
// The timer task's wait for the next timer, and the deadline it has a wake set for.
static fsh_task *fsh_timeouts_waiter = NULL;
static int64_t fsh_timeouts_armed = INT64_MAX;
static int32_t fsh_timeouts_claimed = 0, fsh_main_returned = 0;

static void fsh_timeout_insert(fsh_timeout t) {
  if (fsh_timeout_count == fsh_timeout_capacity) {
    fsh_timeout_capacity = fsh_timeout_capacity ? fsh_timeout_capacity * 2 : 16;
    fsh_timeouts = realloc(fsh_timeouts, fsh_timeout_capacity * sizeof(fsh_timeout));
  }
  int64_t at = fsh_timeout_count;
  while (at > 0 && fsh_timeouts[at - 1].deadline > t.deadline) at--;
  memmove(fsh_timeouts + at + 1, fsh_timeouts + at, (fsh_timeout_count - at) * sizeof(fsh_timeout));
  fsh_timeouts[at] = t;
  fsh_timeout_count++;
}

static fsh_timeout fsh_timeout_take(int64_t at) {
  fsh_timeout t = fsh_timeouts[at];
  memmove(fsh_timeouts + at, fsh_timeouts + at + 1, (fsh_timeout_count - at - 1) * sizeof(fsh_timeout));
  fsh_timeout_count--;
  return t;
}

// Wakes the timer task waiting for the next timer, once something it waits on changed. Called
// with the timers' lock held; the wake happens after it is let go.
static fsh_task *fsh_timeouts_changed(void) {
  fsh_task *waiter = fsh_timeouts_waiter;
  fsh_timeouts_waiter = NULL;
  return waiter;
}

static void fsh_timeouts_wake(fsh_task *waiter) {
  if (!waiter) return;
  fsh_rt_wake(waiter);
  fsh_task_release(waiter);
}

// Whether this call is the one to start the timer task, which then registers it.
int32_t fsh_rt_timeouts_claim(void) {
  fsh_timeouts_starting = __atomic_exchange_n(&fsh_timeouts_claimed, 1, __ATOMIC_ACQ_REL) == 0;
  return fsh_timeouts_starting;
}

// Registered under the tasks' lock, where its end is announced, and announced itself, for a
// main that returned between the claim and now.
void fsh_rt_timeouts_task(fsh_task *task) {
  pthread_mutex_lock(&fsh_alive_lock);
  fsh_timeouts_task = task;
  pthread_cond_broadcast(&fsh_finished);
  pthread_mutex_unlock(&fsh_alive_lock);
}

// Sets a timer for a callable, its delay at least 1 ms, giving its id.
int64_t fsh_rt_timeout_set(void *block, void **vtable, int64_t ms, int32_t repeat) {
  if (ms < 1 || ms > 2147483647) ms = 1;
  pthread_mutex_lock(&fsh_timeouts_lock);
  int64_t id = ++fsh_timeout_ids;
  int64_t now = fsh_now();
  int64_t dl = ms > (INT64_MAX - now) / 1000000 ? INT64_MAX : now + ms * 1000000;
  fsh_timeout_insert((fsh_timeout){ dl, id, repeat ? ms : 0, block, vtable, 0 });
  fsh_task *waiter = fsh_timeouts_changed();
  pthread_mutex_unlock(&fsh_timeouts_lock);
  fsh_timeouts_wake(waiter);
  return id;
}

// Marks a timer as one the program doesn't wait for.
void fsh_rt_timeout_unref(int64_t id) {
  pthread_mutex_lock(&fsh_timeouts_lock);
  for (int64_t at = 0; at < fsh_timeout_count; at++) if (fsh_timeouts[at].id == id) fsh_timeouts[at].weak = 1;
  fsh_task *waiter = fsh_timeouts_changed();
  pthread_mutex_unlock(&fsh_timeouts_lock);
  fsh_timeouts_wake(waiter);
}

// Whether any timer left keeps the program running.
static int32_t fsh_timeouts_strong(void) {
  for (int64_t at = 0; at < fsh_timeout_count; at++) if (!fsh_timeouts[at].weak) return 1;
  return 0;
}

// Clears a timer, dropping its callable; one already run or cleared is left alone.
void fsh_rt_timeout_clear(int64_t id) {
  pthread_mutex_lock(&fsh_timeouts_lock);
  int64_t at = 0;
  while (at < fsh_timeout_count && fsh_timeouts[at].id != id) at++;
  if (at == fsh_timeout_count) return (void)pthread_mutex_unlock(&fsh_timeouts_lock);
  fsh_timeout t = fsh_timeout_take(at);
  fsh_task *waiter = fsh_timeouts_changed();
  pthread_mutex_unlock(&fsh_timeouts_lock);
  ((void (*)(void *))t.vtable[0])(t.block);
  fsh_timeouts_wake(waiter);
}

// Polls for the next timer due, giving its callable's block and vtable in out: 1 with one, an
// interval's own kept and set again its delay from now; 2 once main has returned and no timer
// is left; 0 to wait, woken when one is due or the timers change.
int32_t fsh_rt_timeout_next(fsh_task *task, void **out) {
  pthread_mutex_lock(&fsh_timeouts_lock);
  // Polled again, it is no longer waiting: its count as the waiter is given up, and taken anew
  // if it waits on.
  fsh_task *polled = fsh_timeouts_changed();
  int32_t result = 0;
  int64_t now = fsh_now();
  if (now >= fsh_timeouts_armed) fsh_timeouts_armed = INT64_MAX;
  if (fsh_timeout_count > 0 && fsh_timeouts[0].deadline <= now) {
    fsh_timeout t = fsh_timeout_take(0);
    out[0] = t.block;
    out[1] = t.vtable;
    if (t.every) {
      out[0] = ((void *(*)(void *))t.vtable[1])(t.block);
      t.deadline = t.every > (INT64_MAX - now) / 1000000 ? INT64_MAX : now + t.every * 1000000;
      fsh_timeout_insert(t);
    }
    result = 1;
  } else if (!fsh_timeouts_strong() && fsh_main_returned) result = 2;
  int64_t arm = 0;
  if (result == 0) {
    __atomic_fetch_add(&task->refs, 1, __ATOMIC_RELAXED);
    fsh_timeouts_waiter = task;
    arm = fsh_timeout_count > 0 && fsh_timeouts[0].deadline < fsh_timeouts_armed ? fsh_timeouts[0].deadline : 0;
    if (arm) fsh_timeouts_armed = arm;
  }
  pthread_mutex_unlock(&fsh_timeouts_lock);
  if (polled) fsh_task_release(polled);
  if (arm) {
    __atomic_fetch_add(&task->refs, 1, __ATOMIC_RELAXED);
    fsh_timer_add(arm, task, NULL, &fsh_timeouts);
  }
  if (result == 0) fsh_task_wait(task, "timer_loop", 0);
  return result;
}

// Main has returned: the timer task ends once no timer is left.
static void fsh_timeouts_main_returned(void) {
  pthread_mutex_lock(&fsh_timeouts_lock);
  fsh_main_returned = 1;
  fsh_task *waiter = fsh_timeouts_changed();
  pthread_mutex_unlock(&fsh_timeouts_lock);
  fsh_timeouts_wake(waiter);
}

// Polls a sleep, whose frame holds its state and first the delay in milliseconds, then its
// deadline: done once the deadline has passed, and until then its one timer, added at its first
// poll and never firing early, wakes the task; a poll before then from another wake waits on.
// One whose timer was cancelled (state 2) adds it again, for what is left of its delay.
int32_t fsh_rt_sleep(int64_t *frame, fsh_task *task) {
  int32_t *state = (int32_t *)frame;
  int64_t *deadline = frame + 1;
  if (*state == 2) {
    if (fsh_now() >= *deadline) return 1;
    *state = 1;
    __atomic_fetch_add(&task->refs, 1, __ATOMIC_RELAXED);
    fsh_timer_add(*deadline, task, NULL, frame);
    fsh_task_wait(task, "sleep", 0);
    return 0;
  }
  if (*state != 0) {
    if (fsh_now() >= *deadline) return 1;
    fsh_task_wait(task, "sleep", 0);
    return 0;
  }
  *state = 1;
  int64_t ms = *deadline > 0 ? *deadline : 0, now = fsh_now();
  *deadline = ms > (INT64_MAX - now) / 1000000 ? INT64_MAX : now + ms * 1000000;
  __atomic_fetch_add(&task->refs, 1, __ATOMIC_RELAXED);
  fsh_timer_add(*deadline, task, NULL, frame);
  fsh_task_wait(task, "sleep", 0);
  return 0;
}

// One printed line is several writes; holding the stream's lock across them keeps lines from
// tasks on other threads whole.
// A line for stderr waits for what stdout holds and keeps stdout's lock while it writes, so the
// two streams keep their order and their lines whole in one pipe or file. Stdout's lock is always
// taken first.
void fsh_rt_print_begin(int32_t stream) {
  flockfile(stdout);
  if (stream == 2) {
    fflush(stdout);
    flockfile(stderr);
  }
}

void fsh_rt_print_end(int32_t stream) {
  if (stream == 2) funlockfile(stderr);
  funlockfile(stdout);
}

// process.stdout.write and process.stderr.write go through console.log's buffers and locks, so
// what they write keeps its place among printed lines. What they write is flushed at once,
// since a pipe is fully buffered, and a program answering a reader through one, as a language
// server does, would otherwise say nothing until it exits.
void fsh_rt_stream_write(int32_t stream, const char *bytes, int64_t length) {
  fsh_rt_print_begin(stream);
  FILE *to = stream == 2 ? stderr : stdout;
  fwrite(bytes, 1, length, to);
  fflush(to);
  fsh_rt_print_end(stream);
}

// prompt's message, on stdout as process.stdout.write puts it, declared apart from it because std's
// sections and modules share one set of names.
void fsh_rt_prompt_write(const char *bytes, int64_t length) {
  fsh_rt_stream_write(1, bytes, length);
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


// Whether a lock's holder is a thread's token from before it panicked.
static int fsh_poison_holder(int32_t holder) {
  pthread_mutex_lock(&fsh_poison_lock);
  int found = 0;
  for (int64_t i = 0; i < fsh_poison_count && !found; i++) found = fsh_poison_tokens[i] == holder;
  pthread_mutex_unlock(&fsh_poison_lock);
  return found;
}

// 2 when a task panicked holding the lock, which stays held, so the caller panics too.
int32_t fsh_rt_lock(int32_t *word) {
  int32_t me = fsh_me();
  if (__atomic_load_n(word, __ATOMIC_RELAXED) == me) return 1;
  for (int spins = 0;; spins++) {
    int32_t open = 0;
    if (__atomic_compare_exchange_n(word, &open, me, 1, __ATOMIC_ACQUIRE, __ATOMIC_RELAXED)) {
      fsh_locks_held++;
      return 0;
    }
    if (spins >= 64) {
      if (open && fsh_poison_holder(open)) return 2;
      sched_yield();
    }
  }
}

void fsh_rt_unlock(int32_t *word) {
  fsh_locks_held--;
  __atomic_store_n(word, 0, __ATOMIC_RELEASE);
}

// An RwLock's word: 0 free, n > 0 held by n readers, or minus the token of the thread writing.
// A writer waiting for readers to leave sets FSH_WRITER_WAITING beside their count, and new
// readers wait behind it, so a stream of overlapping reads can't starve an update. A thread
// already reading the same lock still enters, so a read nested in a read never waits on a
// writer that waits on it. The same 1 and 2 as a Lock's: a lock this thread already holds the
// conflicting side of, and a writer that panicked.
#define FSH_WRITER_WAITING 0x40000000

static int fsh_reads(int32_t *word) {
  for (int64_t i = 0; i < fsh_reading_count; i++) if (fsh_reading[i] == word) return 1;
  return 0;
}

int32_t fsh_rt_read_lock(int32_t *word) {
  int32_t me = fsh_me();
  if (__atomic_load_n(word, __ATOMIC_RELAXED) == -me) return 1;
  int nested = fsh_reads(word);
  for (int spins = 0;; spins++) {
    int32_t seen = __atomic_load_n(word, __ATOMIC_RELAXED);
    if (seen >= 0 && (nested || !(seen & FSH_WRITER_WAITING))) {
      if (__atomic_compare_exchange_n(word, &seen, seen + 1, 1, __ATOMIC_ACQUIRE, __ATOMIC_RELAXED)) break;
    } else if (spins >= 64) {
      if (seen < 0 && fsh_poison_holder(-seen)) return 2;
      sched_yield();
    }
  }
  if (fsh_reading_count == fsh_reading_capacity) {
    fsh_reading_capacity = fsh_reading_capacity ? fsh_reading_capacity * 2 : 8;
    fsh_reading = realloc(fsh_reading, fsh_reading_capacity * sizeof(int32_t *));
  }
  fsh_reading[fsh_reading_count++] = word;
  fsh_locks_held++;
  return 0;
}

// Reads end innermost first: a read's callback can't await, so they never interleave.
void fsh_rt_read_unlock(int32_t *word) {
  fsh_reading_count--;
  fsh_locks_held--;
  __atomic_sub_fetch(word, 1, __ATOMIC_RELEASE);
}

// Taking the word clears the waiting mark; another waiting writer sets it again on its next try.
int32_t fsh_rt_write_lock(int32_t *word) {
  int32_t me = fsh_me();
  if (__atomic_load_n(word, __ATOMIC_RELAXED) == -me || fsh_reads(word)) return 1;
  for (int spins = 0;; spins++) {
    int32_t seen = __atomic_load_n(word, __ATOMIC_RELAXED);
    if (seen == 0 || seen == FSH_WRITER_WAITING) {
      if (__atomic_compare_exchange_n(word, &seen, -me, 1, __ATOMIC_ACQUIRE, __ATOMIC_RELAXED)) {
        fsh_locks_held++;
        return 0;
      }
    } else if (seen > 0 && !(seen & FSH_WRITER_WAITING)) {
      __atomic_compare_exchange_n(word, &seen, seen | FSH_WRITER_WAITING, 1, __ATOMIC_RELAXED, __ATOMIC_RELAXED);
    } else if (spins >= 64) {
      if (seen < 0 && fsh_poison_holder(-seen)) return 2;
      sched_yield();
    }
  }
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

// An Rc's block: its strong and weak counts, then a Lock's word and the value. One thread owns
// every handle to it, so the counts change without atomics. The strong handles hold one weak
// count between them, so the block outlives the value until the last Weak lets go.
void *fsh_rt_rc_new(int64_t size) {
  int64_t *block = fsh_rt_alloc(size);
  block[0] = 1;
  block[1] = 1;
  *(int32_t *)(block + 2) = 0;
  return block;
}

void fsh_rt_rc_retain(int64_t *block) {
  if (block) block[0]++;
}

// Whether that was the last strong count, so the caller drops the value, then the weak count.
int32_t fsh_rt_rc_release(int64_t *block) {
  return block && --block[0] == 0;
}

void fsh_rt_weak_retain(int64_t *block) {
  if (block) block[1]++;
}

// A Weak made with nothing to reach, or moved out of its slot, is null and holds no count.
void fsh_rt_weak_release(int64_t *block) {
  if (block && --block[1] == 0) fsh_rt_free(block);
}

// An Rc's word counts the reads running on its value, or is -1 while an update changes it.
// Reads nest; a read under an update, or an update under either, is refused with 1 or 2, which
// the caller turns into a panic, as RefCell's borrow flag does.
int32_t fsh_rt_rc_read(int32_t *word) {
  if (*word < 0) return 1;
  ++*word;
  return 0;
}

void fsh_rt_rc_read_end(int32_t *word) {
  --*word;
}

int32_t fsh_rt_rc_write(int32_t *word) {
  if (*word != 0) return *word < 0 ? 1 : 2;
  *word = -1;
  return 0;
}

void fsh_rt_rc_write_end(int32_t *word) {
  *word = 0;
}

// The block with a new strong count while its value is alive, or null.
void *fsh_rt_rc_upgrade(int64_t *block) {
  if (!block || block[0] == 0) return 0;
  block[0]++;
  return block;
}

// Waits on a semaphore, a channel or a signal, oldest first, each holding a count on its task. A
// task waits once for each of its futures waiting, which the tag tells apart: the future's frame,
// or for a signal its waiting flag.
typedef struct { fsh_task *task; void *tag; } fsh_waiter;
typedef struct { fsh_waiter *tasks; int64_t count, capacity; } fsh_waiters;

// A future already waiting stays where it is: a wake it didn't wait for, from a timer, an abort
// or another future of its task, polls it again, and a second place in line would swallow a wake
// meant for the next.
static void fsh_wait_on(fsh_waiters *w, fsh_task *t, void *tag) {
  for (int64_t i = 0; i < w->count; i++) {
    if (w->tasks[i].task == t && w->tasks[i].tag == tag) return;
  }
  if (w->count == w->capacity) {
    int64_t capacity = w->capacity ? w->capacity * 2 : 4;
    fsh_waiter *tasks = fsh_rt_alloc(capacity * sizeof(fsh_waiter));
    if (w->count) memcpy(tasks, w->tasks, w->count * sizeof(fsh_waiter));
    fsh_rt_free(w->tasks);
    w->tasks = tasks;
    w->capacity = capacity;
  }
  __atomic_fetch_add(&t->refs, 1, __ATOMIC_RELAXED);
  w->tasks[w->count++] = (fsh_waiter){ t, tag };
}

// The oldest waiter's task, taken off the list, for the caller to wake once its lock is released.
// ponytail: O(n) removal from the front, a ring if waiter lists grow long
static fsh_task *fsh_next_waiter(fsh_waiters *w) {
  if (w->count == 0) return NULL;
  fsh_task *t = w->tasks[0].task;
  memmove(w->tasks, w->tasks + 1, --w->count * sizeof(fsh_waiter));
  return t;
}

static void fsh_wake_waiter(fsh_task *t) {
  if (!t) return;
  fsh_rt_wake(t);
  fsh_task_release(t);
}

// Takes a future's wait off a list, for the caller to release its task once its lock is
// released; NULL when it isn't there, as when a wake already took it off.
static fsh_task *fsh_unwait(fsh_waiters *w, fsh_task *t, void *tag) {
  for (int64_t i = 0; i < w->count; i++) {
    if (w->tasks[i].task != t || w->tasks[i].tag != tag) continue;
    memmove(w->tasks + i, w->tasks + i + 1, (--w->count - i) * sizeof(fsh_waiter));
    return t;
  }
  return NULL;
}

static void fsh_waiters_free(fsh_waiters *w) {
  for (int64_t i = 0; i < w->count; i++) fsh_task_release(w->tasks[i].task);
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
int32_t fsh_rt_semaphore_acquire(fsh_semaphore *s, fsh_task *task, fsh_permit **out, void *tag) {
  pthread_mutex_lock(&s->lock);
  int32_t taken = s->permits > 0;
  // One taking a slot while still in line, woken for another of its task's futures, leaves the
  // line, so a later wake goes to a waiter still there.
  fsh_task *mine = taken ? fsh_unwait(&s->waiting, task, tag) : NULL;
  if (taken) s->permits--;
  else fsh_wait_on(&s->waiting, task, tag);
  pthread_mutex_unlock(&s->lock);
  if (mine) fsh_task_release(mine);
  if (!taken) {
    fsh_task_wait(task, "semaphore", 0);
    return 0;
  }
  fsh_rt_block_retain(&s->count);
  fsh_permit *p = fsh_rt_alloc(sizeof(fsh_permit));
  p->count = 1;
  p->semaphore = s;
  *out = p;
  return 1;
}

// An aborted 'acquire' leaves the waiters. One a release already woke passes that wake on, so
// the slot it would have taken isn't left with nobody coming for it.
void fsh_rt_semaphore_leave(fsh_semaphore *s, fsh_task *task, void *tag) {
  pthread_mutex_lock(&s->lock);
  fsh_task *mine = fsh_unwait(&s->waiting, task, tag);
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
int32_t fsh_rt_channel_send(fsh_channel *c, void *value, fsh_task *task, void *tag) {
  pthread_mutex_lock(&c->lock);
  if (c->closed) {
    pthread_mutex_unlock(&c->lock);
    return 3;
  }
  if (c->length == c->capacity) {
    fsh_wait_on(&c->senders, task, tag);
    pthread_mutex_unlock(&c->lock);
    fsh_task_wait(task, "channel.send", 0);
    return 0;
  }
  memcpy(c->ring + (c->head + c->length) % c->capacity * c->size, value, c->size);
  memset(value, 0, c->size);
  c->length++;
  // A send done while still in line leaves it, as an acquire does.
  fsh_task *mine = fsh_unwait(&c->senders, task, tag);
  fsh_task *next = fsh_next_waiter(&c->receivers);
  pthread_mutex_unlock(&c->lock);
  if (mine) fsh_task_release(mine);
  fsh_wake_waiter(next);
  return 1;
}

// Polls 'receive()': moves the oldest value out and wakes a sender, gives 2 with nothing once
// the channel is closed and empty, or waits.
int32_t fsh_rt_channel_receive(fsh_channel *c, void *out, fsh_task *task, void *tag) {
  pthread_mutex_lock(&c->lock);
  if (c->length == 0) {
    int32_t closed = c->closed;
    if (closed) memset(out, 0, c->size);
    else fsh_wait_on(&c->receivers, task, tag);
    pthread_mutex_unlock(&c->lock);
    if (!closed) fsh_task_wait(task, "channel.receive", 0);
    return closed ? 2 : 0;
  }
  memcpy(out, c->ring + c->head * c->size, c->size);
  c->head = (c->head + 1) % c->capacity;
  c->length--;
  // A receive done while still in line leaves it, as an acquire does.
  fsh_task *mine = fsh_unwait(&c->receivers, task, tag);
  fsh_task *next = fsh_next_waiter(&c->senders);
  pthread_mutex_unlock(&c->lock);
  if (mine) fsh_task_release(mine);
  fsh_wake_waiter(next);
  return 1;
}

// An aborted 'send' or 'receive' leaves the waiters, passing on a wake it already took.
void fsh_rt_channel_leave(fsh_channel *c, fsh_task *task, void *tag) {
  pthread_mutex_lock(&c->lock);
  fsh_task *mine = fsh_unwait(&c->receivers, task, tag);
  if (!mine) mine = fsh_unwait(&c->senders, task, tag);
  fsh_task *receiver = !mine && c->length > 0 ? fsh_next_waiter(&c->receivers) : NULL;
  fsh_task *sender = !mine && c->length < c->capacity ? fsh_next_waiter(&c->senders) : NULL;
  pthread_mutex_unlock(&c->lock);
  if (mine) fsh_task_release(mine);
  fsh_wake_waiter(receiver);
  fsh_wake_waiter(sender);
}

// A promise's resolve or reject: moves the value in and closes the channel, waking its receiver,
// unless an earlier settle closed it; 0 then, leaving the value for the caller to drop.
int32_t fsh_rt_channel_settle(fsh_channel *c, void *value) {
  pthread_mutex_lock(&c->lock);
  if (c->closed || c->length == c->capacity) {
    pthread_mutex_unlock(&c->lock);
    return 0;
  }
  memcpy(c->ring + (c->head + c->length) % c->capacity * c->size, value, c->size);
  c->length++;
  c->closed = 1;
  fsh_waiters receivers = c->receivers;
  c->receivers = (fsh_waiters){ NULL, 0, 0 };
  pthread_mutex_unlock(&c->lock);
  for (int64_t i = 0; i < receivers.count; i++) fsh_wake_waiter(receivers.tasks[i].task);
  fsh_rt_free(receivers.tasks);
  return 1;
}

// Closes a channel: what it holds can still be received, and every task waiting is woken to
// see it closed.
void fsh_rt_channel_close(fsh_channel *c) {
  pthread_mutex_lock(&c->lock);
  c->closed = 1;
  fsh_waiters senders = c->senders, receivers = c->receivers;
  c->senders = c->receivers = (fsh_waiters){ NULL, 0, 0 };
  pthread_mutex_unlock(&c->lock);
  for (int64_t i = 0; i < senders.count; i++) fsh_wake_waiter(senders.tasks[i].task);
  for (int64_t i = 0; i < receivers.count; i++) fsh_wake_waiter(receivers.tasks[i].task);
  fsh_rt_free(senders.tasks);
  fsh_rt_free(receivers.tasks);
}

// An abort signal's block, shared by its controller and every signal handle: its count, its lock,
// whether it has aborted, and the tasks waiting on it to. An 'AbortSignal.any' signal also holds a
// count on each of its sources, and each source lists it, uncounted, among the dependents its
// abort aborts: a dependent leaves those lists when it is freed, so a long-lived source doesn't
// keep every signal ever combined with it.
typedef struct fsh_signal {
  int64_t count; pthread_mutex_t lock; int32_t aborted; fsh_waiters waiting;
  struct fsh_signal **deps; int64_t ndeps, capdeps; struct fsh_signal **sources; int64_t nsources;
} fsh_signal;

fsh_signal *fsh_rt_signal_new(void) {
  fsh_signal *s = fsh_rt_alloc(sizeof(fsh_signal));
  s->count = 1;
  pthread_mutex_init(&s->lock, NULL);
  s->aborted = 0;
  s->waiting = (fsh_waiters){ NULL, 0, 0 };
  s->deps = s->sources = NULL;
  s->ndeps = s->capdeps = s->nsources = 0;
  return s;
}

// A growable stack of signals, so a long chain of 'AbortSignal.any' signals is released or
// aborted in a loop rather than one C frame per link.
typedef struct { fsh_signal **at; int64_t n, cap; } fsh_signal_stack;

static void fsh_signal_push(fsh_signal_stack *st, fsh_signal *s) {
  if (st->n == st->cap) {
    st->cap = st->cap ? st->cap * 2 : 8;
    fsh_signal **grown = fsh_rt_alloc(st->cap * (int64_t)sizeof(fsh_signal *));
    if (st->n) memcpy(grown, st->at, st->n * sizeof(fsh_signal *));
    fsh_rt_free(st->at);
    st->at = grown;
  }
  st->at[st->n++] = s;
}

void fsh_rt_signal_release(fsh_signal *s) {
  if (!s || __atomic_sub_fetch(&s->count, 1, __ATOMIC_ACQ_REL) > 0) return;
  fsh_signal_stack dead = { NULL, 0, 0 };
  for (;;) {
    for (int64_t i = 0; i < s->nsources; i++) {
      fsh_signal *from = s->sources[i];
      pthread_mutex_lock(&from->lock);
      for (int64_t j = 0; j < from->ndeps; j++) {
        if (from->deps[j] != s) continue;
        from->deps[j] = from->deps[--from->ndeps];
        break;
      }
      if (from->ndeps == 0) {
        fsh_rt_free(from->deps);
        from->deps = NULL;
        from->capdeps = 0;
      }
      pthread_mutex_unlock(&from->lock);
      if (__atomic_sub_fetch(&from->count, 1, __ATOMIC_ACQ_REL) == 0) fsh_signal_push(&dead, from);
    }
    fsh_rt_free(s->sources);
    fsh_waiters_free(&s->waiting);
    pthread_mutex_destroy(&s->lock);
    fsh_rt_free(s);
    if (dead.n == 0) break;
    s = dead.at[--dead.n];
  }
  fsh_rt_free(dead.at);
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
    fsh_wait_on(&s->waiting, task, waiting);
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
  fsh_task *mine = fsh_unwait(&s->waiting, task, waiting);
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
  fsh_timer_add(ms > (INT64_MAX - now) / 1000000 ? INT64_MAX : now + ms * 1000000, NULL, s, NULL);
  return s;
}

// 'AbortSignal.any(signals)': a signal that aborts with the first of its n sources to, or is
// aborted already when one of them is.
fsh_signal *fsh_rt_signal_any(fsh_signal **from, int64_t n) {
  fsh_signal *s = fsh_rt_signal_new();
  if (n > 0) s->sources = fsh_rt_alloc(n * (int64_t)sizeof(fsh_signal *));
  for (int64_t i = 0; i < n; i++) {
    fsh_signal *f = from[i];
    __atomic_fetch_add(&f->count, 1, __ATOMIC_RELAXED);
    s->sources[s->nsources++] = f;
    pthread_mutex_lock(&f->lock);
    if (__atomic_load_n(&f->aborted, __ATOMIC_ACQUIRE)) __atomic_store_n(&s->aborted, 1, __ATOMIC_RELEASE);
    else if (!__atomic_load_n(&s->aborted, __ATOMIC_ACQUIRE)) {
      if (f->ndeps == f->capdeps) {
        f->capdeps = f->capdeps ? f->capdeps * 2 : 4;
        fsh_signal **grown = fsh_rt_alloc(f->capdeps * (int64_t)sizeof(fsh_signal *));
        if (f->ndeps) memcpy(grown, f->deps, f->ndeps * sizeof(fsh_signal *));
        fsh_rt_free(f->deps);
        f->deps = grown;
      }
      f->deps[f->ndeps++] = s;
    }
    pthread_mutex_unlock(&f->lock);
  }
  return s;
}

// Aborts once, waking every task waiting on the signal to see it, then its dependents the same
// way. Each signal on the stack holds a count of the loop's own; a dependent whose count already
// reached zero is being freed, so it is passed over, not revived.
void fsh_rt_signal_abort(fsh_signal *s) {
  __atomic_fetch_add(&s->count, 1, __ATOMIC_RELAXED);
  fsh_signal_stack todo = { NULL, 0, 0 };
  fsh_signal_push(&todo, s);
  while (todo.n > 0) {
    s = todo.at[--todo.n];
    pthread_mutex_lock(&s->lock);
    __atomic_store_n(&s->aborted, 1, __ATOMIC_RELEASE);
    fsh_waiters waiting = s->waiting;
    s->waiting = (fsh_waiters){ NULL, 0, 0 };
    for (int64_t i = 0; i < s->ndeps; i++) {
      fsh_signal *d = s->deps[i];
      int64_t c = __atomic_load_n(&d->count, __ATOMIC_ACQUIRE);
      while (c > 0 && !__atomic_compare_exchange_n(&d->count, &c, c + 1, 0, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE)) {}
      if (c > 0) fsh_signal_push(&todo, d);
    }
    fsh_rt_free(s->deps);
    s->deps = NULL;
    s->ndeps = s->capdeps = 0;
    pthread_mutex_unlock(&s->lock);
    for (int64_t i = 0; i < waiting.count; i++) fsh_wake_waiter(waiting.tasks[i].task);
    fsh_rt_free(waiting.tasks);
    fsh_rt_signal_release(s);
  }
  fsh_rt_free(todo.at);
}

// A task group's block, shared by the 'taskGroup' call awaiting it, the handle its closure spawns
// through, and every task spawned into it: its count, its lock, how many of its tasks aren't
// done, the task awaiting them, its signal, the first error a task threw, kept as the type the
// await throws until the awaiter takes it, the first panic's reason, and whether the await is
// over, after which dropping the awaiter's handle aborts nothing.
//
// Lock order: a group's lock is the innermost there is. Nothing else is locked and nothing is
// called while it is held: fsh_run gives fsh_alive_lock back before a task's end takes it, and
// the signal is aborted, the awaiter woken and every count released only once it is given back.
typedef struct fsh_group {
  int64_t count; pthread_mutex_t lock; int64_t live; fsh_task *waiter; fsh_signal *signal;
  int32_t errored, over; fsh_str *panic; void *error; int64_t error_size; fsh_drop_fn drop_error;
} fsh_group;

// A new group with one count, its closure's.
fsh_group *fsh_rt_group_new(void) {
  fsh_group *g = fsh_rt_alloc(sizeof(fsh_group));
  g->count = 1;
  pthread_mutex_init(&g->lock, NULL);
  g->live = 0;
  g->waiter = NULL;
  g->signal = fsh_rt_signal_new();
  g->errored = g->over = 0;
  g->panic = NULL;
  g->error = NULL;
  g->error_size = 0;
  g->drop_error = NULL;
  return g;
}

// The awaiter's count on a group just made, before anything runs: with it, room for an error of
// the type the await throws, when it throws one, and the function dropping one never taken.
void fsh_rt_group_scope(fsh_group *g, int64_t error_size, fsh_drop_fn drop_error) {
  __atomic_fetch_add(&g->count, 1, __ATOMIC_RELAXED);
  if (error_size < 0) return;
  g->error = fsh_rt_alloc(error_size > 0 ? error_size : 1);
  g->error_size = error_size;
  g->drop_error = drop_error;
}

// Another handle to the group's signal.
fsh_signal *fsh_rt_group_signal(fsh_group *g) {
  __atomic_fetch_add(&g->signal->count, 1, __ATOMIC_RELAXED);
  return g->signal;
}

// The group's closure threw: its tasks are told to stop.
void fsh_rt_group_abort(fsh_group *g) {
  fsh_rt_signal_abort(g->signal);
}

void fsh_rt_group_release(fsh_group *g) {
  if (!g || __atomic_sub_fetch(&g->count, 1, __ATOMIC_ACQ_REL) > 0) return;
  if (g->errored && g->drop_error) g->drop_error(g->error);
  fsh_rt_free(g->error);
  fsh_rt_str_release(g->panic);
  if (g->waiter) fsh_task_release(g->waiter);
  fsh_rt_signal_release(g->signal);
  pthread_mutex_destroy(&g->lock);
  fsh_rt_free(g);
}

// Drops the awaiter's handle. Before the await is over, its future was dropped where it waited:
// the group's signal is aborted, and its tasks finish on their own, waking nobody.
void fsh_rt_group_drop(fsh_group *g) {
  if (!g) return;
  pthread_mutex_lock(&g->lock);
  int32_t over = g->over;
  fsh_task *waiter = g->waiter;
  g->waiter = NULL;
  pthread_mutex_unlock(&g->lock);
  if (waiter) fsh_task_release(waiter);
  if (!over) fsh_rt_signal_abort(g->signal);
  fsh_rt_group_release(g);
}

// Starts a future as a task of the group, which waits for it and gives no handle to it: the
// runtime's reference is the task's only one, and the task holds a count on the group.
void fsh_rt_group_spawn(fsh_group *g, fsh_poll_fn poll, fsh_drop_fn drop, fsh_drop_fn drop_output, void (*fail)(void *, void *), void *frame, int64_t frame_size, int64_t output_size, const char *name, const char *site) {
  fsh_task *t = fsh_task_new(poll, drop, drop_output, frame, frame_size, output_size, name, site, 0);
  t->refs = 1;
  __atomic_fetch_add(&g->count, 1, __ATOMIC_RELAXED);
  t->group = g;
  t->fail = fail;
  pthread_mutex_lock(&g->lock);
  g->live++;
  pthread_mutex_unlock(&g->lock);
  fsh_schedule(t);
}

// A task of a group is done. The first to throw gives the group its error and the first to
// panic its reason, and either aborts the group's signal; then the task is no longer live, and
// the last one wakes the awaiter. The error is moved outside the lock: only the task that
// claimed the group's room for it writes there, and it is read once no task is live.
static void fsh_group_done(fsh_group *g, fsh_task *t, int32_t result) {
  if (result >= 2) {
    fsh_str *reason = result == 3 ? t->panic : NULL;
    int32_t claimed = 0;
    fsh_rt_str_retain(reason);
    pthread_mutex_lock(&g->lock);
    if (result == 2 && t->fail && g->error && !g->errored) g->errored = claimed = 1;
    if (reason && !g->panic) {
      g->panic = reason;
      reason = NULL;
    }
    pthread_mutex_unlock(&g->lock);
    fsh_rt_str_release(reason);
    if (claimed) {
      t->fail(fsh_output(t), g->error);
      t->outcome = 0;
    }
    fsh_rt_signal_abort(g->signal);
  }
  pthread_mutex_lock(&g->lock);
  fsh_task *waiter = --g->live == 0 ? g->waiter : NULL;
  if (waiter) g->waiter = NULL;
  pthread_mutex_unlock(&g->lock);
  fsh_wake_waiter(waiter);
}

// Awaits a group's tasks. While any is live, the awaiting task is noted for the last of them to
// wake, and this gives 0; so it does while the group's closure is still running and no task has
// failed. Once none is live, it gives 1, or 2 with the first error a task threw moved to out; if
// a task panicked, the awaiter panics at at instead, as one awaiting that task would.
int32_t fsh_rt_group_wait(fsh_group *g, fsh_task *waiter, void *out, const char *at, int32_t running) {
  fsh_task *old = NULL;
  fsh_str *panic = NULL;
  int32_t result = 0;
  pthread_mutex_lock(&g->lock);
  if (g->live > 0) {
    if (g->waiter != waiter) {
      old = g->waiter;
      __atomic_fetch_add(&waiter->refs, 1, __ATOMIC_RELAXED);
      g->waiter = waiter;
    }
  } else if (!running || g->errored || g->panic) {
    g->over = 1;
    panic = g->panic;
    g->panic = NULL;
    result = 1;
    if (!panic && g->errored) {
      memcpy(out, g->error, g->error_size);
      g->errored = 0;
      result = 2;
    }
  }
  pthread_mutex_unlock(&g->lock);
  if (old) fsh_task_release(old);
  if (panic) {
    char reason[1100];
    int n = snprintf(reason, sizeof reason, "a task this awaited panicked: %.*s", (int)panic->length, panic->bytes);
    fsh_rt_str_release(panic);
    fsh_panic_at(at);
    fputs(reason, stderr);
    fsh_panic_reason(reason, n < (int)sizeof reason ? (size_t)n : sizeof reason - 1);
    fsh_rt_panic("\ncatch what can fail inside the group's tasks, or 'spawn' one and await 'handle.join()' to catch its panic\n");
  }
  if (result == 0 && !running) fsh_task_wait(waiter, "task_group", 0);
  return result;
}

// A group's future is cancelled where it waits: the group no longer wakes its task.
void fsh_rt_group_leave(fsh_group *g) {
  if (!g) return;
  pthread_mutex_lock(&g->lock);
  fsh_task *waiter = g->waiter;
  g->waiter = NULL;
  pthread_mutex_unlock(&g->lock);
  if (waiter) fsh_task_release(waiter);
}

// 'process.shutdown': a signal the first SIGINT or SIGTERM aborts. Its handlers are installed the
// first time a program asks for it, so one that never does dies at Ctrl-C as usual. A handler
// only writes the signal's number to a nonblocking pipe, as async-signal-safe code must; a thread
// of its own reads it, aborting the signal the first time and exiting with 128 plus the number the
// second, flushing output but running no drops. The block is static and the runtime holds a count
// on it, so it is never freed.
static fsh_signal fsh_shutdown;
static pthread_once_t fsh_shutdown_once = PTHREAD_ONCE_INIT;
static int fsh_shutdown_pipe[2];

static void fsh_shutdown_caught(int sig) {
  int saved = errno;
  unsigned char number = (unsigned char)sig;
  (void)!write(fsh_shutdown_pipe[1], &number, 1);
  errno = saved;
}

// The second signal's exit flushes what output it can. A stream another thread holds, as one
// blocked writing a line to a full pipe does, is skipped; a flush that blocks itself is cut off
// by the watcher's exit a second later.
static int32_t fsh_shutdown_code;

static void *fsh_shutdown_flush(void *arg) {
  FILE *streams[2] = { stdout, stderr };
  for (int i = 0; i < 2; i++) {
    if (ftrylockfile(streams[i]) != 0) continue;
    fflush(streams[i]);
    funlockfile(streams[i]);
  }
  _exit(fsh_shutdown_code);
}

static void *fsh_shutdown_watch(void *arg) {
  int32_t seen = 0;
  for (;;) {
    unsigned char number;
    ssize_t got = read(fsh_shutdown_pipe[0], &number, 1);
    if (got < 0 && errno == EINTR) continue;
    if (got <= 0) return NULL;
    if (seen++ == 0) {
      __atomic_store_n(&fsh_shutdown_busy, 1, __ATOMIC_SEQ_CST);
      if (!__atomic_load_n(&fsh_stopping, __ATOMIC_SEQ_CST)) fsh_rt_signal_abort(&fsh_shutdown);
      __atomic_store_n(&fsh_shutdown_busy, 0, __ATOMIC_SEQ_CST);
      if (__atomic_load_n(&fsh_stopping, __ATOMIC_SEQ_CST)) {
        pthread_mutex_lock(&fsh_park);
        pthread_cond_signal(&fsh_left);
        pthread_mutex_unlock(&fsh_park);
      }
      continue;
    }
    fsh_shutdown_code = 128 + number;
    pthread_t flusher;
    if (pthread_create(&flusher, NULL, fsh_shutdown_flush, NULL) == 0) {
      struct timespec bound = { 1, 0 };
      nanosleep(&bound, NULL);
    }
    _exit(fsh_shutdown_code);
  }
}

static void fsh_shutdown_waiters_free(void) {
  pthread_mutex_lock(&fsh_shutdown.lock);
  fsh_waiters w = fsh_shutdown.waiting;
  fsh_shutdown.waiting = (fsh_waiters){ NULL, 0, 0 };
  pthread_mutex_unlock(&fsh_shutdown.lock);
  fsh_waiters_free(&w);
}

static void fsh_shutdown_start(void) {
  fsh_sim_init();
  fsh_shutdown.count = 1;
  pthread_mutex_init(&fsh_shutdown.lock, NULL);
  fsh_shutdown_end = fsh_shutdown_waiters_free;
  // In deterministic simulation mode, never spawn a background signal-watcher thread that would
  // race on fsh_sim_ready; leave default SIGINT/SIGTERM process termination in place.
  if (fsh_sim_active) return;
  const char *failed = "fish: the shutdown signal couldn't be set up, so SIGINT and SIGTERM end the program at once\n";
  if (pipe(fsh_shutdown_pipe) != 0) return (void)fputs(failed, stderr);
  fcntl(fsh_shutdown_pipe[0], F_SETFD, FD_CLOEXEC);
  fcntl(fsh_shutdown_pipe[1], F_SETFD, FD_CLOEXEC);
  fcntl(fsh_shutdown_pipe[1], F_SETFL, O_NONBLOCK);
  pthread_t watcher;
  if (pthread_create(&watcher, NULL, fsh_shutdown_watch, NULL) != 0) return (void)fputs(failed, stderr);
  pthread_detach(watcher);
  struct sigaction caught;
  memset(&caught, 0, sizeof caught);
  caught.sa_handler = fsh_shutdown_caught;
  sigemptyset(&caught.sa_mask);
  caught.sa_flags = SA_RESTART;
  sigaction(SIGINT, &caught, NULL);
  sigaction(SIGTERM, &caught, NULL);
}

fsh_signal *fsh_rt_signal_shutdown(void) {
  pthread_once(&fsh_shutdown_once, fsh_shutdown_start);
  __atomic_fetch_add(&fsh_shutdown.count, 1, __ATOMIC_RELAXED);
  return &fsh_shutdown;
}

// Signals a program listens for, counted as they arrive. A handler only writes the signal's number
// to a nonblocking pipe, as async-signal-safe code must, and a thread of its own counts them, so
// std can see a new delivery by its count going up. A signal listened for this way replaces
// whatever handled it before, the shutdown signal's SIGINT and SIGTERM handlers included.
static int64_t fsh_signal_counts[65];
static int fsh_signals_pipe[2] = { -1, -1 };
static pthread_once_t fsh_signals_once = PTHREAD_ONCE_INIT;
static int32_t fsh_signals_ready = 0;

static void fsh_signals_caught(int sig) {
  int saved = errno;
  unsigned char number = (unsigned char)sig;
  (void)!write(fsh_signals_pipe[1], &number, 1);
  errno = saved;
}

static void *fsh_signals_watch(void *arg) {
  for (;;) {
    unsigned char number;
    ssize_t got = read(fsh_signals_pipe[0], &number, 1);
    if (got < 0 && errno == EINTR) continue;
    if (got <= 0) return NULL;
    if (number < 65) __atomic_fetch_add(&fsh_signal_counts[number], 1, __ATOMIC_RELEASE);
  }
}

static void fsh_signals_start(void) {
  if (pipe(fsh_signals_pipe) != 0) return;
  fcntl(fsh_signals_pipe[0], F_SETFD, FD_CLOEXEC);
  fcntl(fsh_signals_pipe[1], F_SETFD, FD_CLOEXEC);
  fcntl(fsh_signals_pipe[1], F_SETFL, O_NONBLOCK);
  pthread_t watcher;
  if (pthread_create(&watcher, NULL, fsh_signals_watch, NULL) != 0) return;
  pthread_detach(watcher);
  fsh_signals_ready = 1;
}

// Starts counting signal n, giving how many have arrived so far, or -1 when it can't be caught.
int64_t fsh_rt_signal_listen(int64_t n) {
  if (n < 1 || n > 64 || n == SIGKILL || n == SIGSTOP) return -1;
#ifdef FSH_PROFILE
  if (n == SIGPROF && fsh_prof_is_active()) return -1;
#endif
  pthread_once(&fsh_signals_once, fsh_signals_start);
  if (!fsh_signals_ready) return -1;
  struct sigaction caught;
  memset(&caught, 0, sizeof caught);
  caught.sa_handler = fsh_signals_caught;
  sigemptyset(&caught.sa_mask);
  caught.sa_flags = SA_RESTART;
  if (sigaction((int)n, &caught, NULL) != 0) return -1;
  return __atomic_load_n(&fsh_signal_counts[n], __ATOMIC_ACQUIRE);
}

int64_t fsh_rt_signal_count(int64_t n) {
  return n < 1 || n > 64 ? 0 : __atomic_load_n(&fsh_signal_counts[n], __ATOMIC_ACQUIRE);
}

// process.kill: 0, or the errno that refused it.
int64_t fsh_rt_kill(int64_t pid, int64_t sig) {
  return kill((pid_t)pid, (int)sig) == 0 ? 0 : errno;
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

struct fsh_file_job;
void fsh_rt_file_job_release(struct fsh_file_job *job);

// A socket's block: its count and its file descriptor, closed with the last count. A connect
// waiting on a host name's lookup has no descriptor yet, only the lookup's job; once looked up,
// it keeps the job while connecting to its tried-th address, to fall back to the next, and the
// time after which that attempt gives way to the next address, or 0. A TLS stream, or a listener
// whose connections are, also has its TLS state and the TLS runtime's calls for it, which only
// that runtime sets, so a program without TLS links no TLS library.
struct fsh_tls_ops;
struct fsh_sim_sock;
static void fsh_sim_sock_close(struct fsh_sim_sock *s);
typedef struct { int64_t count; int fd; int32_t tried; int64_t deadline; struct fsh_file_job *lookup; void *tls; const struct fsh_tls_ops *tls_ops; struct fsh_sim_sock *sim; } fsh_socket;
typedef struct fsh_tls_ops {
  int32_t (*read)(fsh_socket *s, int64_t max, fsh_task *task, fsh_array *out, fsh_str **message);
  int32_t (*write)(fsh_socket *s, fsh_array *bytes, int64_t *written, fsh_task *task, fsh_str **message);
  // Gives a listener's new connection its TLS state, or 0 when it can't.
  int (*accepted)(fsh_socket *listener, fsh_socket *conn);
  void (*release)(fsh_socket *s);
} fsh_tls_ops;

// Linux marks a new socket close-on-exec as it makes it, so a child spawned on another thread
// meanwhile can't inherit it; macOS can't, and its spawns close what they don't name instead.
#ifdef __APPLE__
#define FSH_SOCK_CLOEXEC 0
#define FSH_ACCEPT(fd) accept(fd, NULL, NULL)
#else
#define FSH_SOCK_CLOEXEC SOCK_CLOEXEC
#define FSH_ACCEPT(fd) accept4(fd, NULL, NULL, SOCK_CLOEXEC)
#endif

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
  s->tried = 0;
  s->deadline = 0;
  s->lookup = NULL;
  s->tls = NULL;
  s->tls_ops = NULL;
  s->sim = NULL;
  return s;
}

void fsh_rt_socket_release(fsh_socket *s) {
  if (!s || __atomic_sub_fetch(&s->count, 1, __ATOMIC_ACQ_REL) > 0) return;
  if (s->tls) s->tls_ops->release(s);
  if (s->sim) fsh_sim_sock_close(s->sim);
  if (s->fd >= 0) {
    if (fsh_poller >= 0) fsh_io_forget(s->fd);
    close(s->fd);
  }
  fsh_rt_file_job_release(s->lookup);
  fsh_rt_free(s);
}

// Takes off a connect attempt's deadline timer, fired or not, so it neither holds nor wakes the task.
static void fsh_connect_untimed(fsh_socket *s, fsh_task *task) {
  if (!s->deadline) return;
  fsh_timer_cancel(task, s, NULL);
  s->deadline = 0;
}

// A failed call's IoError message: what was being done, and the system's reason.
// An errno's code, as ENOENT, and libuv's wording for it, which errors carry.
static const struct { int number; const char *code, *text; } fsh_errnos[] = {
  {ENOENT, "ENOENT", "no such file or directory"}, {EACCES, "EACCES", "permission denied"},
  {EISDIR, "EISDIR", "illegal operation on a directory"}, {ENOTDIR, "ENOTDIR", "not a directory"},
  {EEXIST, "EEXIST", "file already exists"}, {EMFILE, "EMFILE", "too many open files"},
  {ENFILE, "ENFILE", "file table overflow"}, {ENOSPC, "ENOSPC", "no space left on device"},
  {EROFS, "EROFS", "read-only file system"}, {ELOOP, "ELOOP", "too many symbolic links encountered"},
  {ENAMETOOLONG, "ENAMETOOLONG", "name too long"}, {EPERM, "EPERM", "operation not permitted"},
  {EINVAL, "EINVAL", "invalid argument"}, {EIO, "EIO", "i/o error"}, {EBUSY, "EBUSY", "resource busy or locked"},
  {EAGAIN, "EAGAIN", "resource temporarily unavailable"}, {ENOTEMPTY, "ENOTEMPTY", "directory not empty"},
  {EXDEV, "EXDEV", "cross-device link not permitted"}, {EFBIG, "EFBIG", "file too large"},
  {ENOSYS, "ENOSYS", "function not implemented"}, {ENOTSUP, "ENOTSUP", "operation not supported on socket"},
  {EBADF, "EBADF", "bad file descriptor"}, {ECHILD, "ECHILD", "no child processes"}, {ECONNREFUSED, "ECONNREFUSED", "connection refused"},
  {ECONNRESET, "ECONNRESET", "connection reset by peer"}, {EPIPE, "EPIPE", "broken pipe"},
  {ETIMEDOUT, "ETIMEDOUT", "connection timed out"}, {EADDRINUSE, "EADDRINUSE", "address already in use"},
  {EADDRNOTAVAIL, "EADDRNOTAVAIL", "address not available"}, {ENOTCONN, "ENOTCONN", "socket is not connected"},
  {EHOSTUNREACH, "EHOSTUNREACH", "host is unreachable"}, {ENETUNREACH, "ENETUNREACH", "network is unreachable"},
};

// The code and wording for an errno, falling back on strerror's, copied out under a lock since its
// text may be shared between threads.
static void fsh_errno_words(int error, char *code, size_t code_size, char *text, size_t text_size) {
  for (size_t i = 0; i < sizeof fsh_errnos / sizeof fsh_errnos[0]; i++) {
    if (fsh_errnos[i].number != error) continue;
    snprintf(code, code_size, "%s", fsh_errnos[i].code);
    snprintf(text, text_size, "%s", fsh_errnos[i].text);
    return;
  }
  static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
  snprintf(code, code_size, "E%d", error);
  pthread_mutex_lock(&lock);
  snprintf(text, text_size, "%s", strerror(error));
  pthread_mutex_unlock(&lock);
}

// An IoError's parts, as the runtime gives them to the code that throws one: its message, code,
// system call and path, the last NULL when it has none.
static int32_t fsh_io_parts(fsh_str **error, const char *message, const char *code, const char *syscall, const char *path) {
  error[0] = fsh_rt_str_from_cstring(message);
  error[1] = fsh_rt_str_from_cstring(code);
  error[2] = fsh_rt_str_from_cstring(syscall);
  error[3] = path ? fsh_rt_str_from_cstring(path) : NULL;
  return 5;
}

// A socket call's failure: Fish's message with the system's reason, and its code and system
// call.
static int32_t fsh_io_failed(fsh_str **error, const char *doing, const char *syscall) {
  static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
  int number = errno;
  char code[32], text[200], message[256];
  fsh_errno_words(number, code, sizeof code, text, sizeof text);
  pthread_mutex_lock(&lock);
  snprintf(message, sizeof message, "%s: %s", doing, strerror(number));
  pthread_mutex_unlock(&lock);
  return fsh_io_parts(error, message, code, syscall, NULL);
}

// A file call's failure, worded as "ENOENT: no such file or directory, open 'x'". A call
// on an open file, as read, names no path.
static int32_t fsh_fs_failed(fsh_str **error, int number, const char *syscall, const char *path) {
  char code[32], text[200];
  fsh_errno_words(number, code, sizeof code, text, sizeof text);
  size_t size = strlen(code) + strlen(text) + strlen(syscall) + (path ? strlen(path) : 0) + 16;
  char *message = fsh_rt_alloc(size);
  if (path) snprintf(message, size, "%s: %s, %s '%s'", code, text, syscall, path);
  else snprintf(message, size, "%s: %s, %s", code, text, syscall);
  int32_t failed = fsh_io_parts(error, message, code, syscall, path);
  fsh_rt_free(message);
  return failed;
}

// A file read or write, or a host name's lookup, on the blocking pool: threads of their own,
// apart from the executor's workers, so a slow disk or resolver never stalls other tasks. A job is counted by the future polling it and
// by the thread working on it; the thread wakes the task when done, and a future dropped first
// leaves the job to the thread to free.
typedef struct fsh_file_job {
  int64_t refs;
  int32_t op;
  int32_t done;
  int error;
  const char *syscall;
  char *path;
  fsh_array data;
  fsh_task *task;
  struct fsh_file_job *next;
#ifdef FSH_LEAK_SITES
  // The frame that submitted it, whose site what the job allocates is charged to.
  const char *site;
  const char *name;
#endif
} fsh_file_job;

static pthread_mutex_t fsh_pool_lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t fsh_pool_ready = PTHREAD_COND_INITIALIZER;
static fsh_file_job *fsh_pool_head = NULL, *fsh_pool_tail = NULL;
// Threads start as jobs arrive and none is free, up to Tokio's default cap, and leave once idle
// for a while; jobs past the cap wait for a thread.
#define FSH_POOL_MAX 512
#define FSH_POOL_IDLE_SECONDS 10
// ponytail: file reads, writes and lookups queue behind blocking tasks once all 512 are busy, as in
// Tokio; give them a pool of their own if programs saturate it.
static int64_t fsh_pool_threads = 0, fsh_pool_idle = 0, fsh_pool_queued = 0;

void fsh_rt_file_job_release(fsh_file_job *job) {
  if (!job || __atomic_sub_fetch(&job->refs, 1, __ATOMIC_ACQ_REL) > 0) return;
  fsh_rt_free(job->path);
  fsh_rt_free(job->data.data);
  fsh_rt_free(job);
}

// Reads a whole file: open, read until the end, close. A failure
// leaves its errno and system call.
static void fsh_read_whole(const char *path, fsh_array *data, int *error, const char **syscall) {
  int fd = open(path, O_RDONLY | O_CLOEXEC);
  if (fd < 0) {
    *error = errno;
    *syscall = "open";
    return;
  }
  int64_t room = 4096;
  data->data = fsh_rt_alloc(room);
  data->length = 0;
  for (;;) {
    if (data->length == room) {
      char *grown = fsh_rt_alloc(room * 2);
      memcpy(grown, data->data, data->length);
      fsh_rt_free(data->data);
      data->data = grown;
      room *= 2;
    }
    ssize_t n = read(fd, data->data + data->length, room - data->length);
    if (n < 0 && errno == EINTR) continue;
    if (n < 0) {
      *error = errno;
      *syscall = "read";
      break;
    }
    if (n == 0) break;
    data->length += n;
  }
  data->capacity = room;
  close(fd);
}

// Writes a whole file, creating it or emptying it first.
static void fsh_write_whole(const char *path, const fsh_array *data, int *error, const char **syscall) {
  int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0666);
  if (fd < 0) {
    *error = errno;
    *syscall = "open";
    return;
  }
  for (int64_t at = 0; at < data->length;) {
    ssize_t n = write(fd, data->data + at, data->length - at);
    if (n < 0 && errno == EINTR) continue;
    if (n < 0) {
      *error = errno;
      *syscall = "write";
      break;
    }
    at += n;
  }
  if (close(fd) < 0 && !*error) {
    *error = errno;
    *syscall = "close";
  }
}

static void fsh_file_read(fsh_file_job *job) {
  fsh_read_whole(job->path, &job->data, &job->error, &job->syscall);
}

static void fsh_file_write(fsh_file_job *job) {
  fsh_write_whole(job->path, &job->data, &job->error, &job->syscall);
}

// A host name's IPv6 and IPv4 addresses, in the order getaddrinfo gives them, into the job's data
// as sockaddr_storage, or getaddrinfo's error code.
static void fsh_host_lookup(fsh_file_job *job) {
  struct addrinfo hints, *found = NULL;
  memset(&hints, 0, sizeof hints);
  hints.ai_family = AF_UNSPEC;
  hints.ai_socktype = SOCK_STREAM;
  job->error = getaddrinfo(job->path, NULL, &hints, &found);
  job->syscall = "getaddrinfo";
  if (job->error) return;
  int64_t count = 0;
  for (struct addrinfo *a = found; a; a = a->ai_next) count += a->ai_family == AF_INET || a->ai_family == AF_INET6;
  struct sockaddr_storage *at = fsh_rt_alloc(count ? count * sizeof *at : 1);
  int64_t n = 0;
  for (struct addrinfo *a = found; a; a = a->ai_next) {
    if (a->ai_family != AF_INET && a->ai_family != AF_INET6) continue;
    memset(&at[n], 0, sizeof at[n]);
    memcpy(&at[n++], a->ai_addr, a->ai_addrlen);
  }
  freeaddrinfo(found);
  job->data.data = (char *)at;
  job->data.length = job->data.capacity = count * sizeof *at;
  if (!count) job->error = EAI_NONAME;
}

// readFileSync, writeFileSync and existsSync: the same reads and writes, on the calling thread.
// Each gives 1, or 5 with the IoError's parts, as a file future's poll does.
int32_t fsh_rt_fs_read_sync(fsh_str *path, fsh_array *out, fsh_str **error) {
  char *c = fsh_rt_str_cstring(path);
  if (!c) return fsh_fs_failed(error, EINVAL, "open", "");
  fsh_array data = { 0 };
  int failure = 0;
  const char *syscall = NULL;
  fsh_read_whole(c, &data, &failure, &syscall);
  int32_t result = 1;
  if (failure) {
    fsh_rt_free(data.data);
    result = fsh_fs_failed(error, failure, syscall, strcmp(syscall, "open") == 0 ? c : NULL);
  } else *out = data;
  fsh_rt_free(c);
  return result;
}

int32_t fsh_rt_fs_write_sync(fsh_str *path, const fsh_array *bytes, fsh_str **error) {
  char *c = fsh_rt_str_cstring(path);
  if (!c) return fsh_fs_failed(error, EINVAL, "open", "");
  int failure = 0;
  const char *syscall = NULL;
  fsh_write_whole(c, bytes, &failure, &syscall);
  int32_t result = failure ? fsh_fs_failed(error, failure, syscall, strcmp(syscall, "open") == 0 ? c : NULL) : 1;
  fsh_rt_free(c);
  return result;
}

int32_t fsh_rt_fs_exists(fsh_str *path) {
  char *c = fsh_rt_str_cstring(path);
  if (!c) return 0;
  int found = access(c, F_OK) == 0;
  fsh_rt_free(c);
  return found;
}

// statSync and lstatSync: size, mode, kind (1 a file, 2 a directory, 3 a symbolic link, 0
// anything else) and the modification time in milliseconds, as Stats has them.
int32_t fsh_rt_fs_stat(fsh_str *path, int32_t follow, int64_t *out, double *mtime, fsh_str **error) {
  const char *syscall = follow ? "stat" : "lstat";
  char *c = fsh_rt_str_cstring(path);
  if (!c) return fsh_fs_failed(error, EINVAL, syscall, "");
  struct stat st;
  if ((follow ? stat(c, &st) : lstat(c, &st)) != 0) {
    int32_t failed = fsh_fs_failed(error, errno, syscall, c);
    fsh_rt_free(c);
    return failed;
  }
  fsh_rt_free(c);
  out[0] = st.st_size;
  out[1] = st.st_mode;
  out[2] = S_ISREG(st.st_mode) ? 1 : S_ISDIR(st.st_mode) ? 2 : S_ISLNK(st.st_mode) ? 3 : 0;
#ifdef __APPLE__
  struct timespec m = st.st_mtimespec;
#else
  struct timespec m = st.st_mtim;
#endif
  *mtime = (double)m.tv_sec * 1000 + (double)m.tv_nsec / 1e6;
  return 1;
}

static int fsh_by_name(const void *a, const void *b) {
  return strcmp(*(const char *const *)a, *(const char *const *)b);
}

// readdirSync: the names in a directory, without . and .., sorted by byte order.
int32_t fsh_rt_fs_readdir(fsh_str *path, fsh_array *out, fsh_str **error) {
  out->data = NULL;
  out->length = out->capacity = 0;
  char *c = fsh_rt_str_cstring(path);
  if (!c) return fsh_fs_failed(error, EINVAL, "scandir", "");
  DIR *dir = opendir(c);
  if (!dir) {
    int32_t failed = fsh_fs_failed(error, errno, "scandir", c);
    fsh_rt_free(c);
    return failed;
  }
  fsh_rt_free(c);
  int64_t count = 0, room = 16;
  char **names = fsh_rt_alloc(room * sizeof(char *));
  for (struct dirent *entry; (entry = readdir(dir));) {
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) continue;
    if (count == room) {
      char **grown = fsh_rt_alloc(room * 2 * sizeof(char *));
      memcpy(grown, names, count * sizeof(char *));
      fsh_rt_free(names);
      names = grown;
      room *= 2;
    }
    size_t n = strlen(entry->d_name);
    names[count] = fsh_rt_alloc(n + 1);
    memcpy(names[count++], entry->d_name, n + 1);
  }
  closedir(dir);
  qsort(names, count, sizeof(char *), fsh_by_name);
  for (int64_t i = 0; i < count; i++) {
    fsh_add(out, fsh_rt_str_from_cstring(names[i]));
    fsh_rt_free(names[i]);
  }
  fsh_rt_free(names);
  return 1;
}

// realpathSync: the resolved path. The path is first made absolute and
// normalised, so ".." takes back the part before it whether that is a link or not, and an empty
// path is the working directory. A failure names the part the walk stops at, followed a part at a
// time: a missing part fails its lstat, and a link that can't be followed its stat, each named
// with the links before it resolved.
int32_t fsh_rt_fs_realpath(fsh_str *path, fsh_str **out, fsh_str **error) {
  char *c = fsh_rt_str_cstring(path);
  if (!c) return fsh_fs_failed(error, EINVAL, "lstat", "");
  char cwd[PATH_MAX];
  if (c[0] != '/' && !getcwd(cwd, sizeof cwd)) {
    int failure = errno;
    fsh_rt_free(c);
    return fsh_fs_failed(error, failure, "uv_cwd", NULL);
  }
  size_t size = (c[0] == '/' ? 0 : strlen(cwd)) + strlen(c) + 2;
  char *whole = fsh_rt_alloc(size);
  snprintf(whole, size, "%s/%s", c[0] == '/' ? "" : cwd, c);
  fsh_rt_free(c);
  char *parts = fsh_rt_alloc(size + 1);
  size_t n = 0;
  char *rest = NULL;
  for (char *part = strtok_r(whole, "/", &rest); part; part = strtok_r(NULL, "/", &rest)) {
    if (strcmp(part, ".") == 0) continue;
    if (strcmp(part, "..") == 0) {
      while (n > 0 && parts[n - 1] != '/') n--;
      if (n > 0) n--;
      continue;
    }
    parts[n++] = '/';
    size_t k = strlen(part);
    memcpy(parts + n, part, k);
    n += k;
  }
  if (n == 0) parts[n++] = '/';
  parts[n] = 0;
  fsh_rt_free(whole);
  char *resolved = realpath(parts, NULL);
  if (resolved) {
    fsh_rt_free(parts);
    *out = fsh_rt_str_from_cstring(resolved);
    free(resolved);
    return 1;
  }
  int failure = errno;
  char *done = fsh_rt_alloc(size + PATH_MAX + 2);
  done[0] = 0;
  const char *call = "lstat";
  struct stat st;
  rest = NULL;
  for (char *part = strtok_r(parts, "/", &rest); part; part = strtok_r(NULL, "/", &rest)) {
    size_t k = strlen(done);
    snprintf(done + k, size + PATH_MAX + 2 - k, "/%s", part);
    if (lstat(done, &st) != 0) {
      failure = errno;
      break;
    }
    if (!S_ISLNK(st.st_mode)) continue;
    char *real = stat(done, &st) == 0 ? realpath(done, NULL) : NULL;
    if (!real) {
      failure = errno;
      call = "stat";
      break;
    }
    snprintf(done, size + PATH_MAX + 2, "%s", strcmp(real, "/") == 0 ? "" : real);
    free(real);
  }
  int32_t result = fsh_fs_failed(error, failure, call, done[0] ? done : "/");
  fsh_rt_free(done);
  fsh_rt_free(parts);
  return result;
}

// mkdtempSync: a new directory named by the prefix and six random characters.
int32_t fsh_rt_fs_mkdtemp(fsh_str *prefix, fsh_str **out, fsh_str **error) {
  char *c = fsh_rt_str_cstring(prefix);
  if (!c) return fsh_fs_failed(error, EINVAL, "mkdtemp", "");
  size_t n = strlen(c);
  char *pattern = fsh_rt_alloc(n + 7);
  memcpy(pattern, c, n);
  memcpy(pattern + n, "XXXXXX", 7);
  fsh_rt_free(c);
  char *made = fsh_rt_alloc(n + 7);
  memcpy(made, pattern, n + 7);
  int32_t result = 1;
  if (mkdtemp(made)) *out = fsh_rt_str_from_cstring(made);
  else result = fsh_fs_failed(error, errno, "mkdtemp", pattern);
  fsh_rt_free(made);
  fsh_rt_free(pattern);
  return result;
}

// mkdirSync. With recursive, a walk up: a prefix missing its parent is retried after
// the prefix cut at its last '/', so *out is the first directory made as that prefix spells it,
// or NULL when every one existed. A failure names the path as given.
int32_t fsh_rt_fs_mkdir(fsh_str *path, int32_t recursive, int64_t mode, fsh_str **out, fsh_str **error) {
  *out = NULL;
  char *c = fsh_rt_str_cstring(path);
  if (!c) return fsh_fs_failed(error, EINVAL, "mkdir", "");
  size_t n = strlen(c), room = 16;
  // Each pending prefix by its length; a parent removed while the walk runs can make more.
  size_t *pending = fsh_rt_alloc(room * sizeof(size_t)), count = 0;
  pending[count++] = n;
  char *at = fsh_rt_alloc(n + 1);
  int failure = 0;
  while (count > 0 && !failure) {
    size_t length = pending[--count];
    memcpy(at, c, length);
    at[length] = 0;
    int made = mkdir(at, (mode_t)mode) == 0 ? 0 : errno;
    char *slash = strrchr(at, '/');
    if (!recursive) failure = made;
    else if (made == 0) {
      if (!*out) *out = fsh_rt_str_from_cstring(at);
    } else if (made == EACCES || made == ENOSPC || made == ENOTDIR || made == EPERM) failure = made;
    else if (made == ENOENT && slash) {
      if (count + 2 > room) {
        size_t *grown = fsh_rt_alloc(room * 2 * sizeof(size_t));
        memcpy(grown, pending, count * sizeof(size_t));
        fsh_rt_free(pending);
        pending = grown;
        room *= 2;
      }
      pending[count++] = length;
      pending[count++] = (size_t)(slash - at);
    } else if (made != ENOENT || count == 0) {
      struct stat st;
      if (stat(at, &st) != 0) failure = errno;
      else if (!S_ISDIR(st.st_mode)) failure = made == EEXIST && count > 0 ? ENOTDIR : EEXIST;
    }
  }
  int32_t result = failure ? fsh_fs_failed(error, failure, "mkdir", c) : 1;
  if (failure && *out) {
    fsh_rt_str_release(*out);
    *out = NULL;
  }
  fsh_rt_free(at);
  fsh_rt_free(pending);
  fsh_rt_free(c);
  return result;
}

// A two-path call's failure, worded as "ENOENT: no such file or directory, rename 'a' -> 'b'",
// its path the first.
static int32_t fsh_fs_failed_two(fsh_str **error, int number, const char *syscall, const char *from, const char *to) {
  char code[32], text[200];
  fsh_errno_words(number, code, sizeof code, text, sizeof text);
  size_t size = strlen(code) + strlen(text) + strlen(syscall) + strlen(from) + strlen(to) + 24;
  char *message = fsh_rt_alloc(size);
  snprintf(message, size, "%s: %s, %s '%s' -> '%s'", code, text, syscall, from, to);
  int32_t failed = fsh_io_parts(error, message, code, syscall, from);
  fsh_rt_free(message);
  return failed;
}

// renameSync.
int32_t fsh_rt_fs_rename(fsh_str *from, fsh_str *to, fsh_str **error) {
  char *a = fsh_rt_str_cstring(from), *b = fsh_rt_str_cstring(to);
  int32_t result = !a || !b ? fsh_fs_failed_two(error, EINVAL, "rename", a ? a : "", b ? b : "")
    : rename(a, b) != 0 ? fsh_fs_failed_two(error, errno, "rename", a, b) : 1;
  fsh_rt_free(a);
  fsh_rt_free(b);
  return result;
}

// The copy itself, as libuv makes it on every system: 0 or an errno. The source opened (a link
// followed), the destination opened or made with its mode (through a link, even a dangling one),
// a copy onto the same file left alone, the times and mode carried over, then the source's size
// in bytes; a failed copy's destination is removed.
static int fsh_copy_file(const char *from, const char *to, int64_t mode) {
  int in = open(from, O_RDONLY | O_CLOEXEC);
  if (in < 0) return errno;
  struct stat src, dst;
  if (fstat(in, &src) != 0) {
    int failure = errno;
    close(in);
    return failure;
  }
  int out = open(to, O_WRONLY | O_CREAT | O_CLOEXEC | (mode & 1 ? O_EXCL : 0), src.st_mode);
  if (out < 0) {
    int failure = errno;
    close(in);
    return failure;
  }
  int failure = 0;
  if (!(mode & 1)) {
    if (fstat(out, &dst) != 0) failure = errno;
    else if (src.st_dev == dst.st_dev && src.st_ino == dst.st_ino) {
      close(in);
      close(out);
      return 0;
    } else if (ftruncate(out, 0) != 0) failure = errno;
  }
#ifdef __APPLE__
  struct timespec times[2] = { src.st_atimespec, src.st_mtimespec };
#else
  struct timespec times[2] = { src.st_atim, src.st_mtim };
#endif
  if (!failure) {
    (void)futimens(out, times);
    (void)!fchown(out, src.st_uid, src.st_gid);
    if (fchmod(out, src.st_mode) != 0 && errno != EPERM) failure = errno;
  }
  int done = 0;
#ifdef __APPLE__
  if (!failure && (mode & 4)) failure = ENOSYS;
  // Darwin's sendfile, which libuv tries first, refuses a directory this way.
  if (!failure && S_ISDIR(src.st_mode)) failure = ENOTSUP;
#else
  if (!failure && (mode & 6)) {
    // FICLONE, written out as linux/fs.h defines it.
    done = ioctl(out, 0x40049409, in) == 0;
    if (!done && (mode & 4)) failure = errno;
  }
#endif
  char buffer[65536];
  int positioned = 1;
  for (off_t at = 0; !failure && !done && at < src.st_size;) {
    size_t want = src.st_size - at < (off_t)sizeof buffer ? (size_t)(src.st_size - at) : sizeof buffer;
    ssize_t got = positioned ? pread(in, buffer, want, at) : read(in, buffer, want);
    if (got < 0 && errno == EINTR) continue;
    if (got < 0 && positioned && at == 0 && (errno == EIO || errno == ESPIPE)) {
      positioned = 0;
      continue;
    }
    if (got <= 0) {
      if (got < 0) failure = errno;
      break;
    }
    for (ssize_t put = 0; put < got && !failure;) {
      ssize_t n = write(out, buffer + put, got - put);
      if (n >= 0) put += n;
      else if (errno != EINTR) failure = errno;
    }
    at += got;
  }
  close(in);
  // An interrupted close has still closed the descriptor, as libuv counts it.
  if (close(out) != 0 && errno != EINTR && !failure) failure = errno;
  if (failure) unlink(to);
  return failure;
}

// copyFileSync, its mode the bits of COPYFILE_EXCL (1), COPYFILE_FICLONE (2) and
// COPYFILE_FICLONE_FORCE (4), checked before the copy.
int32_t fsh_rt_fs_copyfile(fsh_str *from, fsh_str *to, int64_t mode, fsh_str **error) {
  if (mode < 0 || mode > 7) return fsh_io_parts(error, "mode is out of range: >= 0 && <= 7", "ERR_OUT_OF_RANGE", "", NULL);
  char *a = fsh_rt_str_cstring(from), *b = fsh_rt_str_cstring(to);
  int failure = !a || !b ? EINVAL : fsh_copy_file(a, b, mode);
  int32_t result = failure ? fsh_fs_failed_two(error, failure, "copyfile", a ? a : "", b ? b : "") : 1;
  fsh_rt_free(a);
  fsh_rt_free(b);
  return result;
}

// unlinkSync.
int32_t fsh_rt_fs_unlink(fsh_str *path, fsh_str **error) {
  char *c = fsh_rt_str_cstring(path);
  if (!c) return fsh_fs_failed(error, EINVAL, "unlink", "");
  int32_t result = unlink(c) == 0 ? 1 : fsh_fs_failed(error, errno, "unlink", c);
  fsh_rt_free(c);
  return result;
}

// An errno's Node code and wording, for std's fd calls to make an IoError from: written into
// code and text as C strings.
void fsh_rt_errno_words(int64_t number, char *code, int64_t code_size, char *text, int64_t text_size) {
  fsh_errno_words((int)number, code, (size_t)code_size, text, (size_t)text_size);
}

// The string flags for open, as libuv's table reads them, in this system's bits; -1 for one
// it doesn't know.
int64_t fsh_rt_fd_flags(const char *s) {
  size_t length = strlen(s);
  static const struct { const char *names; int64_t bits; } table[] = {
    {"r", O_RDONLY}, {"rs sr", O_RDONLY | O_SYNC}, {"r+", O_RDWR}, {"rs+ sr+", O_RDWR | O_SYNC},
    {"w", O_TRUNC | O_CREAT | O_WRONLY}, {"wx xw", O_TRUNC | O_CREAT | O_WRONLY | O_EXCL},
    {"w+", O_TRUNC | O_CREAT | O_RDWR}, {"wx+ xw+", O_TRUNC | O_CREAT | O_RDWR | O_EXCL},
    {"a", O_APPEND | O_CREAT | O_WRONLY}, {"ax xa", O_APPEND | O_CREAT | O_WRONLY | O_EXCL},
    {"as sa", O_APPEND | O_CREAT | O_WRONLY | O_SYNC}, {"a+", O_APPEND | O_CREAT | O_RDWR},
    {"ax+ xa+", O_APPEND | O_CREAT | O_RDWR | O_EXCL}, {"as+ sa+", O_APPEND | O_CREAT | O_RDWR | O_SYNC},
  };
  for (size_t i = 0; i < sizeof table / sizeof table[0]; i++) {
    for (const char *at = table[i].names; *at;) {
      size_t n = strcspn(at, " ");
      if (n == length && memcmp(at, s, n) == 0) return table[i].bits;
      at += n + (at[n] == ' ');
    }
  }
  return -1;
}

// openSync: the new descriptor, or -errno.
int64_t fsh_rt_fd_open(const char *path, int64_t flags, int64_t mode) {
  int fd;
  do fd = open(path, (int)flags | O_CLOEXEC, (int)mode);
  while (fd < 0 && errno == EINTR);
  return fd < 0 ? -errno : fd;
}

// readSync and writeSync: the count moved, or -errno; a position below 0 is the file's own.
int64_t fsh_rt_fd_read(int64_t fd, uint8_t *at, int64_t length, int64_t position) {
  ssize_t n;
  do n = position < 0 ? read((int)fd, at, (size_t)length) : pread((int)fd, at, (size_t)length, (off_t)position);
  while (n < 0 && errno == EINTR);
  return n < 0 ? -errno : n;
}

int64_t fsh_rt_fd_write(int64_t fd, const uint8_t *at, int64_t length, int64_t position) {
  ssize_t n;
  do n = position < 0 ? write((int)fd, at, (size_t)length) : pwrite((int)fd, at, (size_t)length, (off_t)position);
  while (n < 0 && errno == EINTR);
  return n < 0 ? -errno : n;
}

static double fsh_stat_ms(struct timespec t) {
  return (double)t.tv_sec * 1000 + (double)t.tv_nsec / 1e6;
}

// What Stats holds: size, mode, kind (1 a file, 2 a directory, 3 a link, 0 anything else), nlink,
// dev, ino, uid and gid in out, and the modification, access, change and birth times in
// milliseconds in times. Linux's stat has no birth time, so it is 0 there, as on any
// file system without one.
static void fsh_stat_fill(const struct stat *st, int64_t *out, double *times) {
  out[0] = st->st_size;
  out[1] = st->st_mode;
  out[2] = S_ISREG(st->st_mode) ? 1 : S_ISDIR(st->st_mode) ? 2 : S_ISLNK(st->st_mode) ? 3 : 0;
  out[3] = (int64_t)st->st_nlink;
  out[4] = (int64_t)st->st_dev;
  out[5] = (int64_t)st->st_ino;
  out[6] = st->st_uid;
  out[7] = st->st_gid;
#ifdef __APPLE__
  times[0] = fsh_stat_ms(st->st_mtimespec);
  times[1] = fsh_stat_ms(st->st_atimespec);
  times[2] = fsh_stat_ms(st->st_ctimespec);
  times[3] = fsh_stat_ms(st->st_birthtimespec);
#else
  times[0] = fsh_stat_ms(st->st_mtim);
  times[1] = fsh_stat_ms(st->st_atim);
  times[2] = fsh_stat_ms(st->st_ctim);
  times[3] = 0;
#endif
}

// fstatSync: 0 with what Stats holds, or -errno.
int64_t fsh_rt_fd_stat(int64_t fd, int64_t *out, double *times) {
  struct stat st;
  if (fstat((int)fd, &st) != 0) return -errno;
  fsh_stat_fill(&st, out, times);
  return 0;
}

// statSync and lstatSync: 0 with what Stats holds, or -errno.
int64_t fsh_rt_path_stat(const char *path, int64_t follow, int64_t *out, double *times) {
  struct stat st;
  if ((follow ? stat(path, &st) : lstat(path, &st)) != 0) return -errno;
  fsh_stat_fill(&st, out, times);
  return 0;
}

// fs.constants' open flags, by their place in the list std's constants reads them in.
int64_t fsh_rt_fd_open_flag(int64_t which) {
  static const int64_t flags[] = {O_RDONLY, O_WRONLY, O_RDWR, O_CREAT, O_EXCL, O_TRUNC, O_APPEND, O_NOFOLLOW, O_SYNC};
  return which >= 0 && which < (int64_t)(sizeof flags / sizeof flags[0]) ? flags[which] : 0;
}

// ftruncateSync, fchmodSync, fsyncSync and closeSync on a bare descriptor, by which: 0, or -errno.
// close's EINTR has still closed it, as libuv takes it.
int64_t fsh_rt_fd_call(int64_t which, int64_t fd, int64_t value) {
  int r;
  switch (which) {
    case 0: do r = ftruncate((int)fd, (off_t)value); while (r < 0 && errno == EINTR); break;
    case 1: do r = fchmod((int)fd, (mode_t)value); while (r < 0 && errno == EINTR); break;
    case 2: r = fsync((int)fd); break;
    default: r = close((int)fd); if (r < 0 && errno == EINTR) r = 0; break;
  }
  return r < 0 ? -errno : 0;
}

// A FileHandle's descriptor: counted, and closed when the last count goes unless close took it
// first, so a handle dropped without close still closes its file. A call on the blocking pool
// holds the descriptor in flight from just before its system call until just after, so a close
// from another task can't free the number for reuse under it: the close then falls to the last
// call to finish.
typedef struct fsh_fd { int64_t count; int64_t fd; int64_t busy; int32_t closing; pthread_mutex_t lock; } fsh_fd;

fsh_fd *fsh_rt_fd_hold(int64_t fd) {
  fsh_fd *f = fsh_rt_alloc(sizeof *f);
  f->count = 1;
  f->fd = fd;
  f->busy = 0;
  f->closing = 0;
  pthread_mutex_init(&f->lock, NULL);
  return f;
}

// The descriptor, or -1 once close was called. A borrowed block crosses as the place holding it.
int64_t fsh_rt_fd_of(fsh_fd **f) {
  pthread_mutex_lock(&(*f)->lock);
  int64_t fd = (*f)->closing ? -1 : (*f)->fd;
  pthread_mutex_unlock(&(*f)->lock);
  return fd;
}

// A call's start: the descriptor, now in flight, or -1 once close was called.
int64_t fsh_rt_fd_begin(fsh_fd **f) {
  pthread_mutex_lock(&(*f)->lock);
  int64_t fd = (*f)->closing ? -1 : (*f)->fd;
  if (fd >= 0) (*f)->busy++;
  pthread_mutex_unlock(&(*f)->lock);
  return fd;
}

// A call's end; the last one after a close closes the file.
void fsh_rt_fd_end(fsh_fd **f) {
  pthread_mutex_lock(&(*f)->lock);
  int64_t shut = --(*f)->busy == 0 && (*f)->closing ? (*f)->fd : -1;
  if (shut >= 0) (*f)->fd = -1;
  pthread_mutex_unlock(&(*f)->lock);
  if (shut >= 0) fsh_rt_fd_call(3, shut, 0);
}

// close: the descriptor for the caller to close, -2 when calls in flight will close it as they
// finish, or -1 when close was called before.
int64_t fsh_rt_fd_take(fsh_fd **f) {
  pthread_mutex_lock(&(*f)->lock);
  int64_t fd = (*f)->closing ? -1 : (*f)->fd;
  (*f)->closing = 1;
  if (fd >= 0 && (*f)->busy > 0) fd = -2;
  else if (fd >= 0) (*f)->fd = -1;
  pthread_mutex_unlock(&(*f)->lock);
  return fd;
}

void fsh_rt_fd_release(fsh_fd *f) {
  if (!f || __atomic_sub_fetch(&f->count, 1, __ATOMIC_ACQ_REL) > 0) return;
  if (f->fd >= 0) fsh_rt_fd_call(3, f->fd, 0);
  pthread_mutex_destroy(&f->lock);
  fsh_rt_free(f);
}

// fs/promises watch: a watcher over inotify on Linux and kqueue on macOS. Its wait runs on the
// blocking pool and writes each change as 'c' (change) or 'r' (rename), the name relative to the
// watched directory, and a NUL. The watcher is counted: std holds one count, each wait another,
// so a close from the task whose signal aborted wakes a wait still blocked on another thread and
// the last of the two frees it.
typedef struct { char *rel; int fd; int dir; char **names; ino_t *inos; int64_t count; } fsh_watch_entry;
typedef struct {
  int64_t refs;
  int32_t closed;
  int wake[2];
  int queue;
  int recursive;
  int single;
  char *root;
  char *base;
  fsh_watch_entry *entries;
  int64_t entry_count;
  int64_t last;
} fsh_watch;

static char *fsh_watch_join(const char *a, const char *b) {
  size_t n = strlen(a), m = strlen(b);
  char *s = malloc(n + m + 2);
  memcpy(s, a, n);
  size_t at = n;
  if (n && m) s[at++] = '/';
  memcpy(s + at, b, m + 1);
  return s;
}

// One write is often several kernel events, as a truncate and then the bytes, so an event the
// same as the one just before it in a wait's batch is left out.
static int64_t fsh_watch_put(fsh_watch *w, uint8_t *out, int64_t size, int64_t at, char kind, const char *name) {
  int64_t n = (int64_t)strlen(name);
  if (at + n + 2 > size) return at;
  if (w->last >= 0 && at - w->last == n + 2 && out[w->last] == (uint8_t)kind && !memcmp(out + w->last + 1, name, (size_t)n)) return at;
  w->last = at;
  out[at] = (uint8_t)kind;
  memcpy(out + at + 1, name, (size_t)n);
  out[at + n + 1] = 0;
  return at + n + 2;
}

// An entry's watch ends with its descriptor on macOS; on Linux it is a watch number, not a
// descriptor, and ends with the inotify descriptor or the kernel's own IN_IGNORED.
static void fsh_watch_drop(fsh_watch_entry *e) {
#ifdef __APPLE__
  if (e->fd >= 0) close(e->fd);
#endif
  free(e->rel);
  for (int64_t j = 0; j < e->count; j++) free(e->names[j]);
  free(e->names);
  free(e->inos);
  memset(e, 0, sizeof *e);
  e->fd = -1;
}

static void fsh_watch_free(fsh_watch *w) {
  for (int64_t i = 0; i < w->entry_count; i++) fsh_watch_drop(&w->entries[i]);
  free(w->entries);
  if (w->queue >= 0) close(w->queue);
  close(w->wake[0]);
  close(w->wake[1]);
  free(w->root);
  free(w->base);
  free(w);
}

static void fsh_watch_release(fsh_watch *w) {
  if (__atomic_sub_fetch(&w->refs, 1, __ATOMIC_ACQ_REL) == 0) fsh_watch_free(w);
}

static fsh_watch_entry *fsh_watch_slot(fsh_watch *w) {
  for (int64_t i = 0; i < w->entry_count; i++)
    if (w->entries[i].fd < 0 && !w->entries[i].rel) return &w->entries[i];
  w->entries = realloc(w->entries, (size_t)(w->entry_count + 1) * sizeof *w->entries);
  fsh_watch_entry *e = &w->entries[w->entry_count++];
  memset(e, 0, sizeof *e);
  e->fd = -1;
  return e;
}

static int fsh_watch_is_dir(fsh_watch *w, const char *rel) {
  char *path = fsh_watch_join(w->root, rel);
  struct stat st;
  int dir = lstat(path, &st) == 0 && S_ISDIR(st.st_mode);
  free(path);
  return dir;
}

static void fsh_watch_add(fsh_watch *w, const char *rel, int dir);

#ifdef __APPLE__
// kqueue reports a directory's own writes, not its files', so each file is watched by a
// descriptor of its own, and a directory's names and inodes are kept to tell which entry came,
// went, or was replaced by a rename over it.
static void fsh_watch_scan(fsh_watch *w, const char *rel, char ***names, ino_t **inos, int64_t *count) {
  char *path = fsh_watch_join(w->root, rel);
  DIR *d = opendir(path);
  free(path);
  *names = NULL;
  *inos = NULL;
  *count = 0;
  if (!d) return;
  struct dirent *de;
  while ((de = readdir(d))) {
    if (!strcmp(de->d_name, ".") || !strcmp(de->d_name, "..")) continue;
    *names = realloc(*names, (size_t)(*count + 1) * sizeof **names);
    *inos = realloc(*inos, (size_t)(*count + 1) * sizeof **inos);
    (*names)[*count] = strdup(de->d_name);
    (*inos)[*count] = de->d_ino;
    (*count)++;
  }
  closedir(d);
}

static void fsh_watch_child(fsh_watch *w, const char *rel, const char *name) {
  char *child = fsh_watch_join(rel, name);
  int dir = fsh_watch_is_dir(w, child);
  if (!dir || w->recursive) fsh_watch_add(w, child, dir);
  free(child);
}

static void fsh_watch_add(fsh_watch *w, const char *rel, int dir) {
  char *path = fsh_watch_join(w->root, rel);
  int fd = open(path, O_EVTONLY | O_CLOEXEC);
  free(path);
  if (fd < 0) return;
  fsh_watch_entry *e = fsh_watch_slot(w);
  e->fd = fd;
  e->rel = strdup(rel);
  e->dir = dir;
  int64_t index = e - w->entries;
  struct kevent ev;
  EV_SET(&ev, fd, EVFILT_VNODE, EV_ADD | EV_CLEAR, NOTE_WRITE | NOTE_EXTEND | NOTE_ATTRIB | NOTE_DELETE | NOTE_RENAME, 0, (void *)(intptr_t)index);
  kevent(w->queue, &ev, 1, NULL, 0, NULL);
  if (!dir) return;
  char **names;
  ino_t *inos;
  int64_t count;
  fsh_watch_scan(w, rel, &names, &inos, &count);
  w->entries[index].names = names;
  w->entries[index].inos = inos;
  w->entries[index].count = count;
  for (int64_t i = 0; i < count; i++) fsh_watch_child(w, rel, names[i]);
}

// Drops an entry and, under a directory, everything watched below it.
static void fsh_watch_forget(fsh_watch *w, const char *rel) {
  size_t n = strlen(rel);
  for (int64_t i = 0; i < w->entry_count; i++) {
    char *r = w->entries[i].rel;
    if (r && (!strcmp(r, rel) || (!strncmp(r, rel, n) && r[n] == '/'))) fsh_watch_drop(&w->entries[i]);
  }
}

static int64_t fsh_watch_diff(fsh_watch *w, int64_t index, uint8_t *out, int64_t size, int64_t at) {
  char *rel = strdup(w->entries[index].rel);
  char **names;
  ino_t *inos;
  int64_t count;
  fsh_watch_scan(w, rel, &names, &inos, &count);
  fsh_watch_entry *e = &w->entries[index];
  char **old = e->names;
  ino_t *old_inos = e->inos;
  int64_t old_count = e->count;
  e->names = names;
  e->inos = inos;
  e->count = count;
  for (int64_t i = 0; i < old_count; i++) {
    int64_t j = 0;
    while (j < count && strcmp(names[j], old[i])) j++;
    if (j < count && inos[j] == old_inos[i]) continue;
    char *child = fsh_watch_join(rel, old[i]);
    at = fsh_watch_put(w, out, size, at, 'r', child);
    fsh_watch_forget(w, child);
    free(child);
  }
  for (int64_t j = 0; j < count; j++) {
    int64_t i = 0;
    while (i < old_count && strcmp(names[j], old[i])) i++;
    if (i < old_count && inos[j] == old_inos[i]) continue;
    char *child = fsh_watch_join(rel, names[j]);
    if (i == old_count) at = fsh_watch_put(w, out, size, at, 'r', child);
    free(child);
    fsh_watch_child(w, rel, names[j]);
  }
  for (int64_t i = 0; i < old_count; i++) free(old[i]);
  free(old);
  free(old_inos);
  free(rel);
  return at;
}

static int fsh_watch_start(fsh_watch *w) {
  w->queue = kqueue();
  if (w->queue < 0) return errno;
  fcntl(w->queue, F_SETFD, FD_CLOEXEC);
  struct kevent ev;
  EV_SET(&ev, w->wake[0], EVFILT_READ, EV_ADD, 0, 0, (void *)(intptr_t)-1);
  kevent(w->queue, &ev, 1, NULL, 0, NULL);
  fsh_watch_add(w, "", !w->single);
  return w->entry_count ? 0 : errno ? errno : ENOENT;
}

// One change's events, or none for a change no one asked about, as a directory's attributes: the
// new end of what's written, -1 when nothing is waiting, -2 once woken or the queue fails.
static int64_t fsh_watch_take(fsh_watch *w, uint8_t *out, int64_t size, int64_t at, int block) {
  struct kevent ev;
  struct timespec zero = { 0, 0 };
  int n;
  do n = kevent(w->queue, NULL, 0, &ev, 1, block ? NULL : &zero);
  while (n < 0 && errno == EINTR);
  if (n < 0) return -2;
  if (n == 0) return -1;
  int64_t index = (int64_t)(intptr_t)ev.udata;
  if (index < 0) return -2;
  fsh_watch_entry *e = &w->entries[index];
  if (e->fd < 0) return at;
  const char *name = w->single ? w->base : e->rel;
  if (e->dir && (ev.fflags & NOTE_WRITE)) return fsh_watch_diff(w, index, out, size, at);
  if (e->dir && !(ev.fflags & (NOTE_DELETE | NOTE_RENAME))) return at;
  // A watched entry's own removal is told by its directory's diff; only the root has no directory.
  if (ev.fflags & (NOTE_DELETE | NOTE_RENAME)) return index == 0 ? fsh_watch_put(w, out, size, at, 'r', w->base) : at;
  return fsh_watch_put(w, out, size, at, 'c', name);
}
#else
#include <sys/inotify.h>
// inotify watches a directory's files itself; a recursive watch adds each directory below.
static void fsh_watch_add(fsh_watch *w, const char *rel, int dir) {
  char *path = fsh_watch_join(w->root, rel);
  int wd = inotify_add_watch(w->queue, path, IN_MODIFY | IN_ATTRIB | IN_CREATE | IN_DELETE | IN_MOVED_FROM | IN_MOVED_TO | IN_DELETE_SELF | IN_MOVE_SELF | (dir ? IN_ONLYDIR : 0));
  if (wd < 0) {
    free(path);
    return;
  }
  fsh_watch_entry *e = fsh_watch_slot(w);
  e->fd = wd;
  e->rel = strdup(rel);
  e->dir = dir;
  if (!dir || !w->recursive) {
    free(path);
    return;
  }
  DIR *d = opendir(path);
  free(path);
  if (!d) return;
  struct dirent *de;
  while ((de = readdir(d))) {
    if (!strcmp(de->d_name, ".") || !strcmp(de->d_name, "..")) continue;
    char *child = fsh_watch_join(rel, de->d_name);
    if (fsh_watch_is_dir(w, child)) fsh_watch_add(w, child, 1);
    free(child);
  }
  closedir(d);
}

static int fsh_watch_start(fsh_watch *w) {
  w->queue = inotify_init1(IN_CLOEXEC | IN_NONBLOCK);
  if (w->queue < 0) return errno;
  errno = 0;
  fsh_watch_add(w, "", !w->single);
  return w->entry_count ? 0 : errno ? errno : ENOENT;
}

static int64_t fsh_watch_take(fsh_watch *w, uint8_t *out, int64_t size, int64_t at, int block) {
  struct pollfd fds[2] = { { w->queue, POLLIN, 0 }, { w->wake[0], POLLIN, 0 } };
  int n;
  do n = poll(fds, 2, block ? -1 : 0);
  while (n < 0 && errno == EINTR);
  if (n < 0) return -2;
  if (n == 0) return -1;
  if (fds[1].revents) return -2;
  // Read only what's sure to fit, so no event is read and then lost for want of room.
  char buffer[4096] __attribute__((aligned(__alignof__(struct inotify_event))));
  if (size - at < (int64_t)sizeof buffer + 64) return -1;
  ssize_t got = read(w->queue, buffer, sizeof buffer);
  if (got <= 0) return at;
  for (char *p = buffer; p < buffer + got;) {
    struct inotify_event *ev = (struct inotify_event *)p;
    p += sizeof *ev + ev->len;
    fsh_watch_entry *e = NULL;
    for (int64_t i = 0; i < w->entry_count; i++)
      if (w->entries[i].rel && w->entries[i].fd == ev->wd) e = &w->entries[i];
    if (!e) continue;
    if (ev->mask & IN_IGNORED) {
      fsh_watch_drop(e);
      continue;
    }
    char kind = ev->mask & (IN_MODIFY | IN_ATTRIB) ? 'c' : 'r';
    if (ev->len == 0) {
      // A directory's own events below the root are told by its parent.
      if (e == &w->entries[0] || w->single) at = fsh_watch_put(w, out, size, at, kind, w->base);
      continue;
    }
    char *child = fsh_watch_join(e->rel, ev->name);
    at = fsh_watch_put(w, out, size, at, kind, child);
    if (w->recursive && (ev->mask & IN_ISDIR) && (ev->mask & (IN_CREATE | IN_MOVED_TO))) fsh_watch_add(w, child, 1);
    free(child);
  }
  return at;
}
#endif

// The watcher for a path, or -errno: ENOENT for a missing one.
int64_t fsh_rt_watch_open(const char *path, int64_t recursive) {
  struct stat st;
  if (stat(path, &st) != 0) return -errno;
  fsh_watch *w = calloc(1, sizeof *w);
  w->refs = 1;
  w->queue = -1;
  w->recursive = (int)recursive;
  w->single = !S_ISDIR(st.st_mode);
  w->root = strdup(path);
  const char *slash = strrchr(path, '/');
  w->base = strdup(slash && slash[1] ? slash + 1 : path);
  if (pipe(w->wake) != 0) {
    int failed = errno;
    free(w->root);
    free(w->base);
    free(w);
    return -failed;
  }
  fcntl(w->wake[0], F_SETFD, FD_CLOEXEC);
  fcntl(w->wake[1], F_SETFD, FD_CLOEXEC);
  int failed = fsh_watch_start(w);
  if (failed) {
    fsh_watch_free(w);
    return -failed;
  }
  return (int64_t)(intptr_t)w;
}

// A count for the wait about to start, taken before it reaches the blocking pool.
void fsh_rt_watch_hold(int64_t handle) {
  __atomic_add_fetch(&((fsh_watch *)(intptr_t)handle)->refs, 1, __ATOMIC_ACQ_REL);
}

// Blocks until there are changes, then writes them and whatever else is already waiting: the
// bytes written, or 0 once the watcher is closed. Gives up the count fsh_rt_watch_hold took.
int64_t fsh_rt_watch_wait(int64_t handle, uint8_t *out, int64_t size) {
  fsh_watch *w = (fsh_watch *)(intptr_t)handle;
  int64_t at = 0;
  w->last = -1;
  while (!__atomic_load_n(&w->closed, __ATOMIC_ACQUIRE)) {
    int64_t next = fsh_watch_take(w, out, size, at, at == 0);
    if (next == -2) break;
    if (next == -1) {
      if (at > 0) break;
      continue;
    }
    at = next;
    if (size - at < 4096) break;
  }
  if (__atomic_load_n(&w->closed, __ATOMIC_ACQUIRE)) at = 0;
  fsh_watch_release(w);
  return at;
}

// Ends the watcher: a wait in flight wakes and gives 0, and the last count frees it.
void fsh_rt_watch_close(int64_t handle) {
  fsh_watch *w = (fsh_watch *)(intptr_t)handle;
  if (__atomic_exchange_n(&w->closed, 1, __ATOMIC_ACQ_REL)) return;
  char byte = 1;
  ssize_t ignored = write(w->wake[1], &byte, 1);
  (void)ignored;
  fsh_watch_release(w);
}

// accessSync, its mode the bits of R_OK, W_OK and X_OK, checked before the call.
int32_t fsh_rt_fs_access(fsh_str *path, int64_t mode, fsh_str **error) {
  if (mode < 0 || mode > 7) return fsh_io_parts(error, "mode is out of range: >= 0 && <= 7", "ERR_OUT_OF_RANGE", "", NULL);
  char *c = fsh_rt_str_cstring(path);
  if (!c) return fsh_fs_failed(error, EINVAL, "access", "");
  int32_t result = access(c, (int)mode) == 0 ? 1 : fsh_fs_failed(error, errno, "access", c);
  fsh_rt_free(c);
  return result;
}

// chmodSync, its mode already checked by std.
int32_t fsh_rt_fs_chmod(fsh_str *path, int64_t mode, fsh_str **error) {
  char *c = fsh_rt_str_cstring(path);
  if (!c) return fsh_fs_failed(error, EINVAL, "chmod", "");
  int32_t result = chmod(c, (mode_t)mode) == 0 ? 1 : fsh_fs_failed(error, errno, "chmod", c);
  fsh_rt_free(c);
  return result;
}

// symlinkSync, or with symbolic 0 linkSync: path made a link to target.
int32_t fsh_rt_fs_link(fsh_str *target, fsh_str *path, int32_t symbolic, fsh_str **error) {
  const char *syscall = symbolic ? "symlink" : "link";
  char *a = fsh_rt_str_cstring(target), *b = fsh_rt_str_cstring(path);
  int32_t result = !a || !b ? fsh_fs_failed_two(error, EINVAL, syscall, a ? a : "", b ? b : "")
    : (symbolic ? symlink(a, b) : link(a, b)) != 0 ? fsh_fs_failed_two(error, errno, syscall, a, b) : 1;
  fsh_rt_free(a);
  fsh_rt_free(b);
  return result;
}

// readlinkSync: a link's text, read into a buffer grown until it holds all of it.
int32_t fsh_rt_fs_readlink(fsh_str *path, fsh_str **out, fsh_str **error) {
  char *c = fsh_rt_str_cstring(path);
  if (!c) return fsh_fs_failed(error, EINVAL, "readlink", "");
  for (size_t room = 256;; room *= 2) {
    char *text = fsh_rt_alloc(room);
    ssize_t n = readlink(c, text, room);
    if (n >= 0 && (size_t)n < room) {
      text[n] = 0;
      *out = fsh_rt_str_from_cstring(text);
      fsh_rt_free(text);
      fsh_rt_free(c);
      return 1;
    }
    int failure = errno;
    fsh_rt_free(text);
    if (n < 0) {
      int32_t failed = fsh_fs_failed(error, failure, "readlink", c);
      fsh_rt_free(c);
      return failed;
    }
  }
}

// fs/promises realpath: libuv's realpath(3), unlike realpathSync's walk, every failure named
// realpath with the path as given.
int32_t fsh_rt_fs_realpath_native(fsh_str *path, fsh_str **out, fsh_str **error) {
  char *c = fsh_rt_str_cstring(path);
  if (!c) return fsh_fs_failed(error, EINVAL, "realpath", "");
  char *resolved = realpath(c, NULL);
  if (!resolved) {
    int32_t failed = fsh_fs_failed(error, errno, "realpath", c);
    fsh_rt_free(c);
    return failed;
  }
  fsh_rt_free(c);
  *out = fsh_rt_str_from_cstring(resolved);
  free(resolved);
  return 1;
}

// A time in seconds as libuv 1.51 hands it to utimensat, cut to whole microseconds.
static struct timespec fsh_utime_spec(double time) {
  struct timespec ts;
  ts.tv_sec = time;
  ts.tv_nsec = (time - ts.tv_sec) * 1e9;
  ts.tv_nsec -= ts.tv_nsec % 1000;
  if (ts.tv_nsec < 0) {
    ts.tv_nsec += 1e9;
    ts.tv_sec -= 1;
  }
  return ts;
}

// utimesSync, or with follow 0 lutimesSync, its times in seconds; NaN and the infinities are
// refused first, atime before mtime.
int32_t fsh_rt_fs_utimes(fsh_str *path, double atime, double mtime, int32_t follow, fsh_str **error) {
  double times[2] = {atime, mtime};
  for (int i = 0; i < 2; i++) {
    if (isfinite(times[i])) continue;
    char message[160];
    snprintf(message, sizeof message, "The \"time\" argument must be an instance of Date or an Time in seconds. Received type number (%s)", isnan(times[i]) ? "NaN" : times[i] > 0 ? "Infinity" : "-Infinity");
    return fsh_io_parts(error, message, "ERR_INVALID_ARG_TYPE", "", NULL);
  }
  const char *syscall = follow ? "utime" : "lutime";
  char *c = fsh_rt_str_cstring(path);
  if (!c) return fsh_fs_failed(error, EINVAL, syscall, "");
  struct timespec ts[2] = {fsh_utime_spec(atime), fsh_utime_spec(mtime)};
  int32_t result = utimensat(AT_FDCWD, c, ts, follow ? 0 : AT_SYMLINK_NOFOLLOW) == 0 ? 1 : fsh_fs_failed(error, errno, syscall, c);
  fsh_rt_free(c);
  return result;
}

// An entry another process removed since the walk listed it is gone already, which is no failure.
static int fsh_remove_one(const char *path, const struct stat *st, int kind, struct FTW *walk) {
  (void)st;
  (void)kind;
  (void)walk;
  return remove(path) != 0 && errno != ENOENT;
}

// rmSync: a file, or with recursive a directory and all inside it; force passes over a missing
// path. A directory given without recursive has its own message.
int32_t fsh_rt_fs_rm(fsh_str *path, int32_t recursive, int32_t force, fsh_str **error) {
  char *c = fsh_rt_str_cstring(path);
  if (!c) return fsh_fs_failed(error, EINVAL, "lstat", "");
  struct stat st;
  int32_t result = 1;
  if (lstat(c, &st) != 0) {
    if (!(force && errno == ENOENT)) result = fsh_fs_failed(error, errno, "lstat", c);
  } else if (S_ISDIR(st.st_mode) && !recursive) {
    size_t size = strlen(c) + 64;
    char *message = fsh_rt_alloc(size);
    snprintf(message, size, "Path is a directory: rm returned EISDIR (is a directory) %s", c);
    result = fsh_io_parts(error, message, "ERR_FS_EISDIR", "rm", c);
    fsh_rt_free(message);
  } else if ((S_ISDIR(st.st_mode) ? nftw(c, fsh_remove_one, 16, FTW_DEPTH | FTW_PHYS) : unlink(c)) != 0) {
    result = fsh_fs_failed(error, errno, "rm", c);
  }
  fsh_rt_free(c);
  return result;
}

// A signal's name, as a child's is given: "SIGTERM", or NULL for one it doesn't name.
const char *fsh_rt_signal_name(int64_t number) {
  static const struct { int number; const char *name; } names[] = {
    { SIGHUP, "SIGHUP" }, { SIGINT, "SIGINT" }, { SIGQUIT, "SIGQUIT" }, { SIGILL, "SIGILL" }, { SIGTRAP, "SIGTRAP" },
    { SIGABRT, "SIGABRT" }, { SIGBUS, "SIGBUS" }, { SIGFPE, "SIGFPE" }, { SIGKILL, "SIGKILL" }, { SIGUSR1, "SIGUSR1" },
    { SIGSEGV, "SIGSEGV" }, { SIGUSR2, "SIGUSR2" }, { SIGPIPE, "SIGPIPE" }, { SIGALRM, "SIGALRM" }, { SIGTERM, "SIGTERM" },
    { SIGCHLD, "SIGCHLD" }, { SIGCONT, "SIGCONT" }, { SIGSTOP, "SIGSTOP" }, { SIGTSTP, "SIGTSTP" }, { SIGTTIN, "SIGTTIN" },
    { SIGTTOU, "SIGTTOU" }, { SIGURG, "SIGURG" }, { SIGXCPU, "SIGXCPU" }, { SIGXFSZ, "SIGXFSZ" }, { SIGVTALRM, "SIGVTALRM" },
    { SIGPROF, "SIGPROF" }, { SIGWINCH, "SIGWINCH" }, { SIGIO, "SIGIO" }, { SIGSYS, "SIGSYS" },
  };
  for (size_t i = 0; i < sizeof names / sizeof names[0]; i++) if (names[i].number == number) return names[i].name;
  return NULL;
}

// A close-on-exec pipe whose ends are above 2: were this process's stdin, stdout or stderr closed,
// an end landing on 0, 1 or 2 would be dup2'd onto itself, which keeps it close-on-exec.
static int fsh_pipe(int fds[2]) {
#ifdef __APPLE__
  if (pipe(fds) != 0) return -1;
#else
  if (pipe2(fds, O_CLOEXEC) != 0) return -1;
#endif
  for (int i = 0; i < 2; i++) {
    int moved = fcntl(fds[i], F_DUPFD_CLOEXEC, 3);
    if (moved < 0) {
      int failure = errno;
      close(fds[0]);
      close(fds[1]);
      fds[0] = fds[1] = -1;
      errno = failure;
      return -1;
    }
    close(fds[i]);
    fds[i] = moved;
  }
  return 0;
}

// Reads what a pipe has into a byte array, giving 0 at its end.
static ssize_t fsh_drain(int fd, fsh_array *into) {
  fsh_array_room(into, into->length + 65536, 1);
  ssize_t n = read(fd, into->data + into->length, into->capacity - into->length);
  if (n > 0) into->length += n;
  return n;
}

// A started child's pipes, the input still to write to its stdin, and its pid.
typedef struct {
  pid_t pid;
  int in, out, err;
  uint8_t *input;
  int64_t length;
} fsh_child;

// Writes input to a child's stdin and reads its stdout and stderr until both close, then waits for
// it: numbers gets its pid, exit status (-1 when a signal ended it) and signal (0 for none). Gives
// 0, or the errno that stopped it. With at_exit, reading also stops once the child itself has
// exited, taking what its pipes already hold: a process it left running in
// the background may hold the pipes open long after.
static int fsh_child_wait(pid_t pid, int in_fd, int out_fd, int err_fd, const uint8_t *input, int64_t length, int64_t *numbers, fsh_array *out, fsh_array *err, int at_exit) {
  int failure = 0;
  int in[2] = { -1, in_fd }, outp[2] = { out_fd, -1 }, errp[2] = { err_fd, -1 };
  // A child that exits before reading all its input mustn't end this process with SIGPIPE: the
  // signal is held back on this thread while writing and a pending one taken.
  sigset_t pipe_only, before;
  sigemptyset(&pipe_only);
  sigaddset(&pipe_only, SIGPIPE);
  pthread_sigmask(SIG_BLOCK, &pipe_only, &before);
  if (in[1] >= 0) fcntl(in[1], F_SETFL, fcntl(in[1], F_GETFL) | O_NONBLOCK);
  int64_t written = 0;
  if (in[1] >= 0 && length == 0) {
    close(in[1]);
    in[1] = -1;
  }
  int status = 0, reaped = 0;
  while (in[1] >= 0 || outp[0] >= 0 || errp[0] >= 0) {
    struct pollfd fds[3] = { { in[1], POLLOUT, 0 }, { outp[0], POLLIN, 0 }, { errp[0], POLLIN, 0 } };
    if (poll(fds, 3, at_exit ? 50 : -1) < 0) {
      if (errno == EINTR) continue;
      // Closed, a child blocked writing ends with SIGPIPE rather than waiting forever.
      failure = errno;
      for (int i = 0; i < 3; i++) if (fds[i].fd >= 0) close(fds[i].fd);
      break;
    }
    if (in[1] >= 0 && fds[0].revents) {
      ssize_t n = write(in[1], input + written, length - written);
      if (n > 0) written += n;
      if ((n < 0 && errno != EAGAIN && errno != EINTR) || written == length) {
        close(in[1]);
        in[1] = -1;
      }
    }
    if (outp[0] >= 0 && fds[1].revents) {
      ssize_t n = fsh_drain(outp[0], out);
      if (n == 0 || (n < 0 && errno != EINTR && errno != EAGAIN)) {
        close(outp[0]);
        outp[0] = -1;
      }
    }
    if (errp[0] >= 0 && fds[2].revents) {
      ssize_t n = fsh_drain(errp[0], err);
      if (n == 0 || (n < 0 && errno != EINTR && errno != EAGAIN)) {
        close(errp[0]);
        errp[0] = -1;
      }
    }
    if (at_exit && waitpid(pid, &status, WNOHANG) == pid) {
      reaped = 1;
      int *open_fds[2] = { &outp[0], &errp[0] };
      fsh_array *into[2] = { out, err };
      for (int i = 0; i < 2; i++) {
        if (*open_fds[i] < 0) continue;
        fcntl(*open_fds[i], F_SETFL, fcntl(*open_fds[i], F_GETFL) | O_NONBLOCK);
        while (fsh_drain(*open_fds[i], into[i]) > 0) {}
        close(*open_fds[i]);
        *open_fds[i] = -1;
      }
      if (in[1] >= 0) {
        close(in[1]);
        in[1] = -1;
      }
    }
  }
  sigset_t pending;
  sigpending(&pending);
  if (sigismember(&pending, SIGPIPE)) {
    int taken;
    sigwait(&pipe_only, &taken);
  }
  pthread_sigmask(SIG_SETMASK, &before, NULL);
  int waited = pid;
  if (!reaped) while ((waited = waitpid(pid, &status, 0)) < 0 && errno == EINTR) {}
  // ECHILD, when the program has set SIGCHLD to be ignored: how it ended is lost.
  if (waited < 0) failure = errno;
  numbers[0] = pid;
  numbers[1] = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
  numbers[2] = WIFSIGNALED(status) ? WTERMSIG(status) : 0;
  return failure;
}

// What a child started with bit 9 left: its stdout and stderr, read until they close, and how it
// ended, as fsh_rt_spawn_sync gives them. Blocks, so std runs it on the blocking pool.
int32_t fsh_rt_spawn_finish(int64_t handle, int64_t *numbers, fsh_array *out, fsh_array *err, fsh_str **error) {
  out->data = err->data = NULL;
  out->length = out->capacity = err->length = err->capacity = 0;
  fsh_child *child = (fsh_child *)(intptr_t)handle;
  int failure = fsh_child_wait(child->pid, child->in, child->out, child->err, child->input, child->length, numbers, out, err, 1);
  fsh_rt_free(child->input);
  fsh_rt_free(child);
  if (!failure) return 1;
  char code[32], text[200];
  fsh_errno_words(failure, code, sizeof code, text, sizeof text);
  char message[256];
  snprintf(message, sizeof message, "%s: %s, waitpid", code, text);
  fsh_io_parts(error, message, code, "waitpid", "");
  return 5;
}

// spawnSync: runs a command found on PATH with its arguments, in cwd unless that is empty,
// writing input to its stdin and reading its stdout and stderr until both close, then waiting for
// it. Gives 1 with numbers its pid, exit status (-1 when a signal ended it) and signal (0 for
// none), or 5 with the IoError's parts when it couldn't start. flags holds two
// bits per stream from stdin up, 0 piped, 1 inherited and 2 /dev/null; bit 6 has env, "K=V"
// strings, replace the environment; bit 7 words a failure as Bun does; bit 8 has args begin with
// argv[0]; bit 9 only starts the child, giving its pid and a handle that fsh_rt_spawn_finish takes;
// bit 10 starts it in a process group of its own.
int32_t fsh_rt_spawn_sync(fsh_str *command, const fsh_array *args, fsh_str *cwd, const fsh_array *input, int64_t flags, const fsh_array *env, int64_t *numbers, fsh_array *out, fsh_array *err, fsh_str **error) {
  out->data = err->data = NULL;
  out->length = out->capacity = err->length = err->capacity = 0;
  char *file = fsh_rt_str_cstring(command);
  char *dir = fsh_rt_str_units(cwd) > 0 ? fsh_rt_str_cstring(cwd) : NULL;
  // With bit 8, args holds argv[0] too, so a command found on another PATH keeps its name.
  int64_t skip = (flags & 256) && args->length > 0 ? 0 : 1;
  char **argv = fsh_rt_alloc((args->length + skip + 1) * sizeof(char *));
  int bad = !file || (fsh_rt_str_units(cwd) > 0 && !dir);
  argv[0] = file;
  for (int64_t i = 0; i < args->length; i++) {
    argv[i + skip] = fsh_rt_str_cstring(((fsh_str **)args->data)[i]);
    bad |= !argv[i + skip];
  }
  argv[args->length + skip] = NULL;
  extern char **environ;
  char **envp = environ;
  if (flags & 64) {
    envp = fsh_rt_alloc((env->length + 1) * sizeof(char *));
    for (int64_t i = 0; i < env->length; i++) {
      envp[i] = fsh_rt_str_cstring(((fsh_str **)env->data)[i]);
      bad |= !envp[i];
    }
    envp[env->length] = NULL;
  }
  int in[2] = { -1, -1 }, outp[2] = { -1, -1 }, errp[2] = { -1, -1 };
  int *pipes[3] = { in, outp, errp };
  int failure = bad ? EINVAL : 0;
  for (int fd = 0; fd < 3 && !failure; fd++) if (((flags >> (2 * fd)) & 3) == 0 && fsh_pipe(pipes[fd]) != 0) failure = errno;
  pid_t pid = 0;
  // What this process printed comes before what a child writes to a stream they share.
  if (!failure && (flags & 60)) fflush(NULL);
  if (!failure) {
    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
    for (int fd = 0; fd < 3; fd++) {
      int mode = (flags >> (2 * fd)) & 3;
      // A descriptor dup2'd onto itself loses close-on-exec, so an inherited one survives
      // POSIX_SPAWN_CLOEXEC_DEFAULT.
      if (mode == 0) posix_spawn_file_actions_adddup2(&actions, pipes[fd][fd == 0 ? 0 : 1], fd);
      else if (mode == 1) posix_spawn_file_actions_adddup2(&actions, fd, fd);
      else posix_spawn_file_actions_addopen(&actions, fd, "/dev/null", fd == 0 ? O_RDONLY : O_WRONLY, 0);
    }
    if (dir) posix_spawn_file_actions_addchdir_np(&actions, dir);
    posix_spawnattr_t attributes;
    posix_spawnattr_init(&attributes);
    short spawn_flags = 0;
#ifdef __APPLE__
    // Only the three pipes reach the child, whatever other threads have open.
    spawn_flags |= POSIX_SPAWN_CLOEXEC_DEFAULT;
#endif
    if (flags & 1024) {
      spawn_flags |= POSIX_SPAWN_SETPGROUP;
      posix_spawnattr_setpgroup(&attributes, 0);
    }
    posix_spawnattr_setflags(&attributes, spawn_flags);
    // A relative command with a slash is looked for in the child's directory. The system is given
    // its whole path, since macOS can start one from there and still answer ENOENT.
    char whole[PATH_MAX], here[PATH_MAX];
    const char *path = file;
    if (dir && file[0] != '/' && strchr(file, '/')) {
      int n = dir[0] == '/' ? snprintf(whole, sizeof whole, "%s/%s", dir, file) : getcwd(here, sizeof here) ? snprintf(whole, sizeof whole, "%s/%s/%s", here, dir, file) : -1;
      if (n > 0 && (size_t)n < sizeof whole) path = whole;
    }
    failure = posix_spawnp(&pid, path, &actions, &attributes, argv, envp);
    posix_spawnattr_destroy(&attributes);
    posix_spawn_file_actions_destroy(&actions);
  }
  for (int i = 0; i < 2; i++) {
    if (failure && in[1 - i] >= 0) close(in[1 - i]);
    if (failure && outp[i] >= 0) close(outp[i]);
    if (failure && errp[i] >= 0) close(errp[i]);
  }
  if (!failure) {
    if (in[0] >= 0) close(in[0]);
    if (outp[1] >= 0) close(outp[1]);
    if (errp[1] >= 0) close(errp[1]);
    if (flags & 512) {
      // Started only: the pipes and the input wait in a handle for fsh_rt_spawn_finish.
      fsh_child *child = fsh_rt_alloc(sizeof(fsh_child));
      child->pid = pid;
      child->in = in[1];
      child->out = outp[0];
      child->err = errp[0];
      child->length = input->length;
      child->input = fsh_rt_alloc(input->length > 0 ? input->length : 1);
      if (input->length > 0) memcpy(child->input, input->data, input->length);
      numbers[0] = pid;
      numbers[1] = (int64_t)(intptr_t)child;
      numbers[2] = 0;
    } else failure = fsh_child_wait(pid, in[1], outp[0], errp[0], input->data, input->length, numbers, out, err, 0);
  }
  if (failure) {
    const char *name = !skip && argv[0] ? argv[0] : file ? file : "";
    char code[32], text[200];
    fsh_errno_words(failure, code, sizeof code, text, sizeof text);
    size_t size = 2 * strlen(name) + strlen(text) + 64;
    char *syscall = fsh_rt_alloc(size), *message = fsh_rt_alloc(size);
    if (flags & 128) {
      snprintf(syscall, size, "posix_spawn");
      snprintf(message, size, "%s: %s, posix_spawn '%s'", code, text, name);
    } else {
      snprintf(syscall, size, "spawnSync %s", name);
      snprintf(message, size, "spawnSync %s %s", name, code);
    }
    fsh_io_parts(error, message, code, syscall, name);
    fsh_rt_free(syscall);
    fsh_rt_free(message);
    fsh_rt_free(out->data);
    fsh_rt_free(err->data);
    out->data = err->data = NULL;
    out->length = out->capacity = err->length = err->capacity = 0;
  }
  for (int64_t i = 0; i < args->length + skip; i++) fsh_rt_free(argv[i]);
  if (!skip) fsh_rt_free(file);
  fsh_rt_free(argv);
  if (envp != environ) {
    for (int64_t i = 0; i < env->length; i++) fsh_rt_free(envp[i]);
    fsh_rt_free(envp);
  }
  fsh_rt_free(dir);
  return failure ? 5 : 1;
}

// A blocking task is polled where a worker would poll it; it is the job's only content.
static void fsh_pool_run(fsh_file_job *job) {
  fsh_task *task = job->task;
  fsh_rt_free(job);
  fsh_run(task);
}

static void *fsh_pool_work(void *arg) {
  (void)arg;
#ifdef FSH_PROFILE
  int prof_slot = fsh_prof_register();
#endif
  pthread_mutex_lock(&fsh_pool_lock);
  for (;;) {
    while (!fsh_pool_head) {
      struct timespec until;
      clock_gettime(CLOCK_REALTIME, &until);
      until.tv_sec += FSH_POOL_IDLE_SECONDS;
      fsh_pool_idle++;
      int waited = pthread_cond_timedwait(&fsh_pool_ready, &fsh_pool_lock, &until);
      fsh_pool_idle--;
      if (waited == ETIMEDOUT && !fsh_pool_head) {
        fsh_pool_threads--;
        pthread_mutex_unlock(&fsh_pool_lock);
#ifdef FSH_PROFILE
        fsh_prof_unregister(prof_slot);
#endif
        return NULL;
      }
    }
    fsh_file_job *job = fsh_pool_head;
    fsh_pool_head = job->next;
    if (!fsh_pool_head) fsh_pool_tail = NULL;
    fsh_pool_queued--;
    pthread_mutex_unlock(&fsh_pool_lock);
    if (job->op == 3) {
      fsh_pool_run(job);
      pthread_mutex_lock(&fsh_pool_lock);
      continue;
    }
#ifdef FSH_LEAK_SITES
    volatile fsh_frame submitter = { job->site, job->name, NULL };
    __atomic_signal_fence(__ATOMIC_RELEASE);
    __atomic_store_n(&fsh_rt_frames, job->name ? (fsh_frame *)&submitter : NULL, __ATOMIC_RELAXED);
#endif
    if (job->op == 0) fsh_file_read(job);
    else if (job->op == 1) fsh_file_write(job);
    else fsh_host_lookup(job);
#ifdef FSH_LEAK_SITES
    __atomic_store_n(&fsh_rt_frames, NULL, __ATOMIC_RELAXED);
    __atomic_signal_fence(__ATOMIC_SEQ_CST);
#endif
    // Under the pool's lock, so a poll from another task can't hand the job over meanwhile.
    pthread_mutex_lock(&fsh_pool_lock);
    fsh_task *task = job->task;
    __atomic_store_n(&job->done, 1, __ATOMIC_RELEASE);
    pthread_mutex_unlock(&fsh_pool_lock);
    fsh_rt_wake(task);
    fsh_task_release(task);
    fsh_rt_file_job_release(job);
    if (__atomic_sub_fetch(&fsh_pool_busy, 1, __ATOMIC_SEQ_CST) == 0 && __atomic_load_n(&fsh_stopping, __ATOMIC_SEQ_CST)) {
      pthread_mutex_lock(&fsh_park);
      pthread_cond_signal(&fsh_left);
      pthread_mutex_unlock(&fsh_park);
    }
    pthread_mutex_lock(&fsh_pool_lock);
  }
}

// Queues a job with the pool's lock held, starting a thread when more jobs wait than threads are
// free. Threads get the workers' 8 MiB stack, since a blocking task runs a program's own calls.
static void fsh_pool_enqueue(fsh_file_job *job) {
  job->next = NULL;
  if (fsh_pool_tail) fsh_pool_tail->next = job;
  else fsh_pool_head = job;
  fsh_pool_tail = job;
  fsh_pool_queued++;
  if (fsh_pool_queued > fsh_pool_idle && fsh_pool_threads < FSH_POOL_MAX) {
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setstacksize(&attr, 8 << 20);
    pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
    pthread_t thread;
    if (pthread_create(&thread, &attr, fsh_pool_work, NULL) == 0) fsh_pool_threads++;
    pthread_attr_destroy(&attr);
    // With no thread at all, the job would wait forever.
    if (fsh_pool_threads == 0) {
      fputs("fish: couldn't start a thread for the blocking pool\n", stderr);
      abort();
    }
  }
  pthread_cond_signal(&fsh_pool_ready);
}

static void fsh_pool_submit(fsh_file_job *job) {
  if (fsh_sim_active) {
    if (job->op == 0) fsh_file_read(job);
    else if (job->op == 1) fsh_file_write(job);
    else fsh_host_lookup(job);
    fsh_task *task = job->task;
    __atomic_store_n(&job->done, 1, __ATOMIC_RELEASE);
    fsh_rt_wake(task);
    fsh_task_release(task);
    fsh_rt_file_job_release(job);
    return;
  }
  pthread_mutex_lock(&fsh_pool_lock);
#ifdef FSH_LEAK_SITES
  job->site = fsh_rt_frames ? fsh_rt_frames->site : NULL;
  job->name = fsh_rt_frames ? fsh_rt_frames->name : NULL;
#endif
  __atomic_add_fetch(&fsh_pool_busy, 1, __ATOMIC_SEQ_CST);
  fsh_pool_enqueue(job);
  pthread_mutex_unlock(&fsh_pool_lock);
}

static void fsh_pool_task(fsh_task *t) {
  fsh_file_job *job = fsh_rt_alloc(sizeof(fsh_file_job));
  memset(job, 0, sizeof *job);
  job->op = 3;
  job->task = t;
  pthread_mutex_lock(&fsh_pool_lock);
  fsh_pool_enqueue(job);
  pthread_mutex_unlock(&fsh_pool_lock);
}

// Polls a readFile (op 0) or writeFile (op 1): its first poll hands the job to the pool and waits;
// once the thread is done, 1 with what a read gave in out, or 5 with the IoError's parts.
// A job still running is polled by this task: an async generator paused on it may be polled again
// from another task after its wait was cancelled, and the job wakes whoever polled it last.
static int32_t fsh_job_done(fsh_file_job *job, fsh_task *task) {
  if (__atomic_load_n(&job->done, __ATOMIC_ACQUIRE)) return 1;
  fsh_task *old = NULL;
  pthread_mutex_lock(&fsh_pool_lock);
  int32_t done = job->done;
  if (!done && job->task != task) {
    old = job->task;
    __atomic_fetch_add(&task->refs, 1, __ATOMIC_RELAXED);
    job->task = task;
  }
  pthread_mutex_unlock(&fsh_pool_lock);
  if (old) fsh_task_release(old);
  return done;
}

int32_t fsh_rt_file_poll(fsh_str *path, fsh_array *bytes, fsh_file_job **job_at, int32_t op, fsh_task *task, fsh_array *out, fsh_str **error) {
  fsh_file_job *job = *job_at;
  if (!job) {
    // A path holding a NUL names no file C can open.
    char *c = fsh_rt_str_cstring(path);
    if (!c) return fsh_fs_failed(error, EINVAL, "open", "");
    job = fsh_rt_alloc(sizeof(fsh_file_job));
    memset(job, 0, sizeof *job);
    job->refs = 2;
    job->op = op;
    job->path = c;
    if (op == 1 && bytes->length > 0) {
      job->data.data = fsh_rt_alloc(bytes->length);
      memcpy(job->data.data, bytes->data, bytes->length);
      job->data.length = job->data.capacity = bytes->length;
    }
    __atomic_fetch_add(&task->refs, 1, __ATOMIC_RELAXED);
    job->task = task;
    *job_at = job;
    fsh_pool_submit(job);
    fsh_task_wait(task, op == 0 ? "file.read" : "file.write", 0);
    return 0;
  }
  if (!fsh_job_done(job, task)) {
    fsh_task_wait(task, op == 0 ? "file.read" : "file.write", 0);
    return 0;
  }
  if (job->error) return fsh_fs_failed(error, job->error, job->syscall, strcmp(job->syscall, "open") == 0 ? job->path : NULL);
  if (op == 0) {
    *out = job->data;
    job->data.data = NULL;
    job->data.length = job->data.capacity = 0;
  }
  return 1;
}

#define FSH_ADDRESS_SIZE(at) ((socklen_t)((at)->ss_family == AF_INET6 ? sizeof(struct sockaddr_in6) : sizeof(struct sockaddr_in)))

static void fsh_address_port(struct sockaddr_storage *at, int64_t port) {
  if (at->ss_family == AF_INET6) ((struct sockaddr_in6 *)at)->sin6_port = htons((uint16_t)port);
  else ((struct sockaddr_in *)at)->sin_port = htons((uint16_t)port);
}

// An IPv4 or IPv6 address and port from a string and a number, or 0 with the message saying why not.
static int fsh_address(fsh_str *host, int64_t port, struct sockaddr_storage *at, fsh_str **message) {
  char *text = fsh_rt_str_cstring(host);
  memset(at, 0, sizeof *at);
  struct sockaddr_in *v4 = (struct sockaddr_in *)at;
  struct sockaddr_in6 *v6 = (struct sockaddr_in6 *)at;
  char reason[320];
  reason[0] = 0;
  if (port < 0 || port > 65535) snprintf(reason, sizeof reason, "port %lld is outside 0 to 65535", (long long)port);
  else if (text && inet_pton(AF_INET, text, &v4->sin_addr) == 1) at->ss_family = AF_INET;
  else if (text && inet_pton(AF_INET6, text, &v6->sin6_addr) == 1) at->ss_family = AF_INET6;
  else snprintf(reason, sizeof reason, "'%.200s' is not an IP address like 127.0.0.1 or ::1; host names aren't looked up", text ? text : "");
  if (!reason[0]) fsh_address_port(at, port);
  fsh_rt_free(text);
  if (reason[0] && message) fsh_io_parts(message, reason, "EINVAL", "connect", NULL);
  return !reason[0];
}

// In-memory virtual TCP network and fault injection for deterministic simulation mode.
// Active only when FISH_SIM_SEED is set; zero impact on real sockets.
enum {
  FSH_SIM_EV_ACCEPT = 1,
  FSH_SIM_EV_CONN_FAIL = 2,
  FSH_SIM_EV_DATA = 3,
  FSH_SIM_EV_EOF = 4,
  FSH_SIM_EV_RESET = 5,
};

typedef struct fsh_sim_sock {
  int64_t refs;
  int32_t kind; // 0 listener, 1 stream
  int32_t closed;
  int32_t peer_eof;
  int32_t peer_reset;
  int32_t connect_state; // 0 connected, 1 connecting, 2 failed
  int connect_errno;
  char host[64];
  uint16_t port;
  char peer_host[64];
  uint16_t peer_port;
  int64_t last_deliver_at;
  struct fsh_sim_sock *peer;
  fsh_waiters waiters;
  // Listener pending accepted connections.
  fsh_socket **accept_q;
  int64_t accept_head, accept_count, accept_cap;
  // Stream receive buffer.
  uint8_t *rx;
  int64_t rx_head, rx_len, rx_cap;
} fsh_sim_sock;

typedef struct {
  int64_t deliver_at;
  uint64_t seq;
  int32_t kind;
  int err;
  fsh_sim_sock *dst;
  fsh_socket *conn;
  uint8_t *data;
  int64_t len;
} fsh_sim_event;

typedef struct {
  char a[96];
  char b[96];
} fsh_sim_partition_rule;

static fsh_sim_sock **fsh_sim_listeners = NULL;
static int64_t fsh_sim_listener_count = 0, fsh_sim_listener_cap = 0;
static fsh_sim_event *fsh_sim_events = NULL;
static int64_t fsh_sim_event_count = 0, fsh_sim_event_cap = 0;
static fsh_sim_partition_rule *fsh_sim_partitions = NULL;
static int64_t fsh_sim_partition_count = 0, fsh_sim_partition_cap = 0;
static int64_t fsh_sim_delay_min_ms = 0, fsh_sim_delay_max_ms = 0;
static double fsh_sim_drop_rate = 0.0;
static uint16_t fsh_sim_next_port = 10000;
static int32_t fsh_sim_stopping = 0;

static void fsh_sim_sock_retain(fsh_sim_sock *s) {
  if (s) s->refs++;
}

static void fsh_sim_sock_release(fsh_sim_sock *s) {
  if (!s || --s->refs > 0) return;
  fsh_waiters_free(&s->waiters);
  free(s->accept_q);
  free(s->rx);
  fsh_rt_free(s);
}

static void fsh_sim_wake_all(fsh_waiters *w) {
  fsh_waiters list = *w;
  *w = (fsh_waiters){ NULL, 0, 0 };
  for (int64_t i = 0; i < list.count; i++) {
    if (fsh_sim_stopping) fsh_task_release(list.tasks[i].task);
    else fsh_wake_waiter(list.tasks[i].task);
  }
  fsh_rt_free(list.tasks);
}

static int fsh_sim_event_before(fsh_sim_event a, fsh_sim_event b) {
  return a.deliver_at < b.deliver_at || (a.deliver_at == b.deliver_at && a.seq < b.seq);
}

static void fsh_sim_event_swap(int64_t a, int64_t b) {
  fsh_sim_event t = fsh_sim_events[a];
  fsh_sim_events[a] = fsh_sim_events[b];
  fsh_sim_events[b] = t;
}

static void fsh_sim_event_push(fsh_sim_event ev) {
  if (fsh_sim_event_count == fsh_sim_event_cap) {
    int64_t cap = fsh_sim_event_cap ? fsh_sim_event_cap * 2 : 64;
    fsh_sim_events = realloc(fsh_sim_events, (size_t)cap * sizeof(fsh_sim_event));
    fsh_sim_event_cap = cap;
  }
  ev.seq = ++fsh_timer_seq;
  int64_t at = fsh_sim_event_count++;
  fsh_sim_events[at] = ev;
  while (at > 0 && fsh_sim_event_before(fsh_sim_events[at], fsh_sim_events[(at - 1) / 2])) {
    fsh_sim_event_swap(at, (at - 1) / 2);
    at = (at - 1) / 2;
  }
}

static fsh_sim_event fsh_sim_event_pop(void) {
  fsh_sim_event taken = fsh_sim_events[0];
  fsh_sim_events[0] = fsh_sim_events[--fsh_sim_event_count];
  for (int64_t at = 0;;) {
    int64_t least = at, left = at * 2 + 1, right = left + 1;
    if (left < fsh_sim_event_count && fsh_sim_event_before(fsh_sim_events[left], fsh_sim_events[least])) least = left;
    if (right < fsh_sim_event_count && fsh_sim_event_before(fsh_sim_events[right], fsh_sim_events[least])) least = right;
    if (least == at) break;
    fsh_sim_event_swap(at, least);
    at = least;
  }
  return taken;
}

static int64_t fsh_sim_sample_delay_ns(void) {
  if (fsh_sim_delay_max_ms <= 0) return 0;
  uint64_t span = (uint64_t)(fsh_sim_delay_max_ms - fsh_sim_delay_min_ms);
  int64_t ms = fsh_sim_delay_min_ms;
  if (span > 0) {
    uint64_t range = span + 1ULL;
    uint64_t off = range == 0 ? fsh_sim_next_u64(fsh_sim_sched_rng) : (fsh_sim_next_u64(fsh_sim_sched_rng) % range);
    if (off > (uint64_t)(INT64_MAX - ms)) ms = INT64_MAX;
    else ms += (int64_t)off;
  }
  if (ms > (INT64_MAX - fsh_sim_now_ns) / 1000000) return INT64_MAX - fsh_sim_now_ns;
  return ms * 1000000LL;
}

static int64_t fsh_sim_next_deliver_at(fsh_sim_sock *sender) {
  int64_t d = fsh_sim_sample_delay_ns();
  int64_t at = fsh_sim_now_ns + d;
  if (sender && at < sender->last_deliver_at) at = sender->last_deliver_at;
  if (sender) sender->last_deliver_at = at;
  return at;
}

static int fsh_sim_should_drop(void) {
  if (fsh_sim_drop_rate <= 0.0) return 0;
  if (fsh_sim_drop_rate >= 1.0) return 1;
  return fsh_sim_next_f64(fsh_sim_sched_rng) < fsh_sim_drop_rate;
}

static int fsh_sim_endpoint_match(const char *rule, const char *host, uint16_t port) {
  if (strcmp(rule, "*") == 0) return 1;
  if (strcmp(rule, host) == 0) return 1;
  char full[96];
  snprintf(full, sizeof full, "%s:%u", host, (unsigned)port);
  if (strcmp(rule, full) == 0) return 1;
  if (strchr(host, ':') != NULL) {
    snprintf(full, sizeof full, "[%s]:%u", host, (unsigned)port);
    if (strcmp(rule, full) == 0) return 1;
  }
  return 0;
}

static int fsh_sim_is_partitioned(const char *h1, uint16_t p1, const char *h2, uint16_t p2) {
  for (int64_t i = 0; i < fsh_sim_partition_count; i++) {
    const char *a = fsh_sim_partitions[i].a;
    const char *b = fsh_sim_partitions[i].b;
    if ((fsh_sim_endpoint_match(a, h1, p1) && fsh_sim_endpoint_match(b, h2, p2)) ||
        (fsh_sim_endpoint_match(a, h2, p2) && fsh_sim_endpoint_match(b, h1, p1))) {
      return 1;
    }
  }
  return 0;
}

static int fsh_sim_host_matches(const char *listener_host, const char *target_host) {
  if (strcmp(listener_host, target_host) == 0) return 1;
  if (strcmp(listener_host, "::") == 0) return 1;
  if (strcmp(listener_host, "0.0.0.0") == 0 && strchr(target_host, ':') == NULL) return 1;
  return 0;
}

static int fsh_sim_port_in_use(const char *host, uint16_t port) {
  for (int64_t i = 0; i < fsh_sim_listener_count; i++) {
    fsh_sim_sock *l = fsh_sim_listeners[i];
    if (!l->closed && l->port == port && (fsh_sim_host_matches(l->host, host) || fsh_sim_host_matches(host, l->host))) return 1;
  }
  return 0;
}

static uint16_t fsh_sim_alloc_port(const char *host) {
  for (int tries = 0; tries < 50000; tries++) {
    uint16_t p = fsh_sim_next_port++;
    if (fsh_sim_next_port > 60000) fsh_sim_next_port = 10000;
    if (!fsh_sim_port_in_use(host, p)) return p;
  }
  return 0;
}

static fsh_socket *fsh_sim_socket_new(int32_t kind, const char *host, uint16_t port) {
  fsh_sim_sock *sim = fsh_rt_alloc(sizeof(fsh_sim_sock));
  memset(sim, 0, sizeof *sim);
  sim->refs = 1;
  sim->kind = kind;
  snprintf(sim->host, sizeof sim->host, "%s", host);
  sim->port = port;
  fsh_socket *s = fsh_rt_alloc(sizeof(fsh_socket));
  memset(s, 0, sizeof *s);
  s->count = 1;
  s->fd = -1;
  s->sim = sim;
  return s;
}

static void fsh_sim_listener_add(fsh_sim_sock *l) {
  if (fsh_sim_listener_count == fsh_sim_listener_cap) {
    int64_t cap = fsh_sim_listener_cap ? fsh_sim_listener_cap * 2 : 16;
    fsh_sim_listeners = realloc(fsh_sim_listeners, (size_t)cap * sizeof(fsh_sim_sock *));
    fsh_sim_listener_cap = cap;
  }
  fsh_sim_listeners[fsh_sim_listener_count++] = l;
}

static void fsh_sim_listener_remove(fsh_sim_sock *l) {
  for (int64_t i = 0; i < fsh_sim_listener_count; i++) {
    if (fsh_sim_listeners[i] == l) {
      fsh_sim_listeners[i] = fsh_sim_listeners[--fsh_sim_listener_count];
      return;
    }
  }
}

static fsh_sim_sock *fsh_sim_listener_find(const char *host, uint16_t port) {
  for (int64_t i = 0; i < fsh_sim_listener_count; i++) {
    fsh_sim_sock *l = fsh_sim_listeners[i];
    if (!l->closed && l->port == port && fsh_sim_host_matches(l->host, host)) return l;
  }
  return NULL;
}

static void fsh_sim_sock_close(fsh_sim_sock *s) {
  s->closed = 1;
  if (s->kind == 0) {
    fsh_sim_listener_remove(s);
    while (s->accept_count > 0) {
      fsh_socket *conn = s->accept_q[s->accept_head];
      s->accept_head = (s->accept_head + 1) % s->accept_cap;
      s->accept_count--;
      fsh_rt_socket_release(conn);
    }
    fsh_sim_wake_all(&s->waiters);
  } else {
    fsh_sim_wake_all(&s->waiters);
    fsh_sim_sock *peer = s->peer;
    s->peer = NULL;
    if (peer) {
      if (!peer->closed && !fsh_sim_stopping) {
        int64_t at = fsh_sim_next_deliver_at(s);
        fsh_sim_sock_retain(peer);
        fsh_sim_event_push((fsh_sim_event){ at, 0, FSH_SIM_EV_EOF, 0, peer, NULL, NULL, 0 });
      }
      fsh_sim_sock_release(peer);
    }
  }
  fsh_sim_sock_release(s);
}

static void fsh_sim_deliver_event(fsh_sim_event ev) {
  if (ev.kind == FSH_SIM_EV_ACCEPT) {
    fsh_sim_sock *l = ev.dst;
    fsh_socket *srv_sock = ev.conn;
    fsh_sim_sock *srv = srv_sock->sim;
    fsh_sim_sock *cli = srv->peer;
    int part = cli ? (fsh_sim_is_partitioned(cli->host, cli->port, l->host, l->port) || fsh_sim_is_partitioned(cli->host, cli->port, srv->host, srv->port)) : 0;
    if (l->closed || part || !cli || cli->closed) {
      if (cli && !cli->closed && cli->connect_state == 1) {
        cli->connect_state = 2;
        cli->connect_errno = l->closed ? ECONNREFUSED : EHOSTUNREACH;
        fsh_sim_wake_all(&cli->waiters);
      }
      fsh_rt_socket_release(srv_sock);
    } else {
      if (l->accept_count == l->accept_cap) {
        int64_t cap = l->accept_cap ? l->accept_cap * 2 : 16;
        fsh_socket **q = malloc((size_t)cap * sizeof(fsh_socket *));
        for (int64_t i = 0; i < l->accept_count; i++) q[i] = l->accept_q[(l->accept_head + i) % l->accept_cap];
        free(l->accept_q);
        l->accept_q = q;
        l->accept_head = 0;
        l->accept_cap = cap;
      }
      l->accept_q[(l->accept_head + l->accept_count) % l->accept_cap] = srv_sock;
      l->accept_count++;
      cli->connect_state = 0;
      fsh_sim_wake_all(&l->waiters);
      fsh_sim_wake_all(&cli->waiters);
    }
    fsh_sim_sock_release(l);
  } else if (ev.kind == FSH_SIM_EV_CONN_FAIL) {
    fsh_sim_sock *cli = ev.dst;
    if (!cli->closed && cli->connect_state == 1) {
      cli->connect_state = 2;
      cli->connect_errno = ev.err;
      fsh_sim_wake_all(&cli->waiters);
    }
    fsh_sim_sock_release(cli);
  } else if (ev.kind == FSH_SIM_EV_DATA) {
    fsh_sim_sock *dst = ev.dst;
    if (!dst->closed && !dst->peer_reset && ev.len > 0) {
      if (fsh_sim_is_partitioned(dst->peer_host, dst->peer_port, dst->host, dst->port)) {
        dst->peer_reset = 1;
        fsh_sim_wake_all(&dst->waiters);
      } else {
        if (dst->rx_head + dst->rx_len + ev.len > dst->rx_cap) {
          if (dst->rx_head > 0 && dst->rx_len > 0) memmove(dst->rx, dst->rx + dst->rx_head, (size_t)dst->rx_len);
          dst->rx_head = 0;
          if (dst->rx_len + ev.len > dst->rx_cap) {
            int64_t cap = dst->rx_cap ? dst->rx_cap * 2 : 4096;
            while (cap < dst->rx_len + ev.len) cap *= 2;
            dst->rx = realloc(dst->rx, (size_t)cap);
            dst->rx_cap = cap;
          }
        }
        memcpy(dst->rx + dst->rx_head + dst->rx_len, ev.data, (size_t)ev.len);
        dst->rx_len += ev.len;
        fsh_sim_wake_all(&dst->waiters);
      }
    }
    free(ev.data);
    fsh_sim_sock_release(dst);
  } else if (ev.kind == FSH_SIM_EV_EOF) {
    fsh_sim_sock *dst = ev.dst;
    if (!dst->closed) {
      dst->peer_eof = 1;
      fsh_sim_wake_all(&dst->waiters);
    }
    fsh_sim_sock_release(dst);
  } else if (ev.kind == FSH_SIM_EV_RESET) {
    fsh_sim_sock *dst = ev.dst;
    if (!dst->closed) {
      dst->peer_reset = 1;
      fsh_sim_wake_all(&dst->waiters);
    }
    fsh_sim_sock_release(dst);
  }
}

static void fsh_sim_fire_due(void) {
  for (;;) {
    int has_t = fsh_timer_count > 0 && fsh_timers[0].deadline <= fsh_sim_now_ns;
    int has_e = fsh_sim_event_count > 0 && fsh_sim_events[0].deliver_at <= fsh_sim_now_ns;
    if (!has_t && !has_e) break;
    int take_t = 0;
    if (has_t && !has_e) take_t = 1;
    else if (has_t && has_e) {
      take_t = fsh_timers[0].deadline < fsh_sim_events[0].deliver_at ||
        (fsh_timers[0].deadline == fsh_sim_events[0].deliver_at && fsh_timers[0].seq < fsh_sim_events[0].seq);
    }
    if (take_t) {
      fsh_timer due = fsh_timer_take();
      fsh_timer_fire(due, 1);
    } else {
      fsh_sim_event ev = fsh_sim_event_pop();
      fsh_sim_deliver_event(ev);
    }
  }
}

static int fsh_sim_next_event_ns(int64_t *out) {
  int found = 0;
  int64_t best = 0;
  if (fsh_timer_count > 0) {
    best = fsh_timers[0].deadline;
    found = 1;
  }
  if (fsh_sim_event_count > 0 && (!found || fsh_sim_events[0].deliver_at < best)) {
    best = fsh_sim_events[0].deliver_at;
    found = 1;
  }
  if (found) *out = best;
  return found;
}

static void fsh_sim_drain_events(void) {
  while (fsh_sim_event_count > 0) {
    fsh_sim_event ev = fsh_sim_event_pop();
    free(ev.data);
    if (ev.conn) fsh_rt_socket_release(ev.conn);
    if (ev.dst) fsh_sim_sock_release(ev.dst);
  }
  free(fsh_sim_events);
  fsh_sim_events = NULL;
  fsh_sim_event_cap = 0;
}

static void fsh_sim_free_globals(void) {
  free(fsh_sim_ready);
  fsh_sim_ready = NULL;
  fsh_sim_ready_count = fsh_sim_ready_cap = 0;
  free(fsh_sim_listeners);
  fsh_sim_listeners = NULL;
  fsh_sim_listener_count = fsh_sim_listener_cap = 0;
  free(fsh_sim_partitions);
  fsh_sim_partitions = NULL;
  fsh_sim_partition_count = fsh_sim_partition_cap = 0;
}

static int fsh_sim_normalize_host(fsh_str *host, int64_t port, char out[64], int allow_localhost, fsh_str **message) {
  char *text = fsh_rt_str_cstring(host);
  if (allow_localhost && text && strcmp(text, "localhost") == 0) {
    fsh_rt_free(text);
    if (port < 0 || port > 65535) {
      struct sockaddr_storage dummy;
      fsh_address(host, port, &dummy, message);
      return 0;
    }
    snprintf(out, 64, "127.0.0.1");
    return 1;
  }
  fsh_rt_free(text);
  struct sockaddr_storage at;
  if (!fsh_address(host, port, &at, message)) return 0;
  if (at.ss_family == AF_INET) {
    inet_ntop(AF_INET, &((struct sockaddr_in *)&at)->sin_addr, out, 64);
  } else {
    inet_ntop(AF_INET6, &((struct sockaddr_in6 *)&at)->sin6_addr, out, 64);
  }
  return 1;
}

// Public C entry points for the std:sim module.
int32_t fsh_rt_sim_enabled(void) {
  fsh_sim_init();
  return fsh_sim_active;
}

uint64_t fsh_rt_sim_seed(void) {
  fsh_sim_init();
  return fsh_sim_seed_val;
}

int64_t fsh_rt_sim_now(void) {
  fsh_sim_init();
  return fsh_sim_active ? fsh_sim_now_ns / 1000000 : fsh_rt_now_ms();
}

void fsh_rt_sim_advance(int64_t ms) {
  fsh_sim_init();
  if (!fsh_sim_active || ms <= 0) return;
  if (ms > (INT64_MAX - fsh_sim_now_ns) / 1000000) fsh_sim_now_ns = INT64_MAX;
  else fsh_sim_now_ns += ms * 1000000LL;
  fsh_sim_fire_due();
}

void fsh_rt_sim_partition(const char *a, const char *b) {
  fsh_sim_init();
  if (!fsh_sim_active || !a || !b) return;
  char ka[96], kb[96];
  snprintf(ka, sizeof ka, "%s", a);
  snprintf(kb, sizeof kb, "%s", b);
  for (int64_t i = 0; i < fsh_sim_partition_count; i++) {
    if ((strcmp(fsh_sim_partitions[i].a, ka) == 0 && strcmp(fsh_sim_partitions[i].b, kb) == 0) ||
        (strcmp(fsh_sim_partitions[i].a, kb) == 0 && strcmp(fsh_sim_partitions[i].b, ka) == 0)) {
      return;
    }
  }
  if (fsh_sim_partition_count == fsh_sim_partition_cap) {
    int64_t cap = fsh_sim_partition_cap ? fsh_sim_partition_cap * 2 : 8;
    fsh_sim_partitions = realloc(fsh_sim_partitions, (size_t)cap * sizeof(fsh_sim_partition_rule));
    fsh_sim_partition_cap = cap;
  }
  snprintf(fsh_sim_partitions[fsh_sim_partition_count].a, sizeof fsh_sim_partitions[0].a, "%s", ka);
  snprintf(fsh_sim_partitions[fsh_sim_partition_count].b, sizeof fsh_sim_partitions[0].b, "%s", kb);
  fsh_sim_partition_count++;
}

void fsh_rt_sim_heal(const char *a, const char *b) {
  fsh_sim_init();
  if (!fsh_sim_active || !a || !b) return;
  char ka[96], kb[96];
  snprintf(ka, sizeof ka, "%s", a);
  snprintf(kb, sizeof kb, "%s", b);
  for (int64_t i = 0; i < fsh_sim_partition_count;) {
    if ((strcmp(fsh_sim_partitions[i].a, ka) == 0 && strcmp(fsh_sim_partitions[i].b, kb) == 0) ||
        (strcmp(fsh_sim_partitions[i].a, kb) == 0 && strcmp(fsh_sim_partitions[i].b, ka) == 0)) {
      fsh_sim_partitions[i] = fsh_sim_partitions[--fsh_sim_partition_count];
    } else {
      i++;
    }
  }
}

void fsh_rt_sim_set_delay(int64_t min_ms, int64_t max_ms) {
  fsh_sim_init();
  if (!fsh_sim_active) return;
  if (min_ms < 0) min_ms = 0;
  if (max_ms < min_ms) max_ms = min_ms;
  fsh_sim_delay_min_ms = min_ms;
  fsh_sim_delay_max_ms = max_ms;
}

void fsh_rt_sim_set_drop_rate(double rate) {
  fsh_sim_init();
  if (!fsh_sim_active) return;
  if (isnan(rate) || rate < 0.0) rate = 0.0;
  if (rate > 1.0) rate = 1.0;
  fsh_sim_drop_rate = rate;
}

void fsh_rt_sim_reset_faults(void) {
  fsh_sim_init();
  if (!fsh_sim_active) return;
  fsh_sim_partition_count = 0;
  fsh_sim_delay_min_ms = 0;
  fsh_sim_delay_max_ms = 0;
  fsh_sim_drop_rate = 0.0;
}

// 'TcpListener.bind(host, port)': listening at once, or 5 with the reason.
int32_t fsh_rt_tcp_bind(fsh_str *host, int64_t port, fsh_socket **out, fsh_str **message) {
  fsh_sim_init();
  if (fsh_sim_active) {
    char norm[64];
    if (!fsh_sim_normalize_host(host, port, norm, 0, message)) return 5;
    uint16_t bound = (uint16_t)port;
    if (bound == 0) {
      bound = fsh_sim_alloc_port(norm);
      if (bound == 0) {
        errno = EADDRNOTAVAIL;
        return fsh_io_failed(message, "can't listen there", "listen");
      }
    } else if (fsh_sim_port_in_use(norm, bound)) {
      errno = EADDRINUSE;
      return fsh_io_failed(message, "can't listen there", "listen");
    }
    *out = fsh_sim_socket_new(0, norm, bound);
    fsh_sim_listener_add((*out)->sim);
    return 1;
  }
  struct sockaddr_storage at;
  if (!fsh_address(host, port, &at, message)) return 5;
  int fd = socket(at.ss_family, SOCK_STREAM | FSH_SOCK_CLOEXEC, 0);
  if (fd < 0) return fsh_io_failed(message, "can't make a socket", "socket");
  int on = 1, off = 0;
  setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, sizeof on);
  // "::" takes IPv4 clients too, unless asked for IPv6 only.
  if (at.ss_family == AF_INET6) setsockopt(fd, IPPROTO_IPV6, IPV6_V6ONLY, &off, sizeof off);
  if (bind(fd, (struct sockaddr *)&at, FSH_ADDRESS_SIZE(&at)) < 0 || listen(fd, 128) < 0) {
    int32_t failed = fsh_io_failed(message, "can't listen there", "listen");
    close(fd);
    return failed;
  }
  *out = fsh_socket_new(fd);
  return 1;
}

int64_t fsh_rt_tcp_port(fsh_socket *s) {
  if (s->sim) return (int64_t)s->sim->port;
  struct sockaddr_storage at;
  socklen_t size = sizeof at;
  if (getsockname(s->fd, (struct sockaddr *)&at, &size) < 0) return -1;
  if (at.ss_family != AF_INET && at.ss_family != AF_INET6) return 0;
  return ntohs(at.ss_family == AF_INET6 ? ((struct sockaddr_in6 *)&at)->sin6_port : ((struct sockaddr_in *)&at)->sin_port);
}

// Polls 'accept()': a new connection, a wait for one, or 5 with the reason.
// A client that gave up before it was accepted is skipped, as servers expect.
int32_t fsh_rt_tcp_accept(fsh_socket *listener, fsh_task *task, fsh_socket **out, fsh_str **message) {
  if (listener->sim) {
    fsh_sim_sock *l = listener->sim;
    if (l->accept_count > 0) {
      *out = l->accept_q[l->accept_head];
      l->accept_head = (l->accept_head + 1) % l->accept_cap;
      l->accept_count--;
      return 1;
    }
    if (l->closed) {
      errno = EBADF;
      return fsh_io_failed(message, "can't accept a connection", "accept");
    }
    fsh_wait_on(&l->waiters, task, listener);
    fsh_task_wait(task, "tcp.accept", 0);
    return 0;
  }
  int fd;
  while ((fd = FSH_ACCEPT(listener->fd)) < 0 && (errno == EINTR || errno == ECONNABORTED || errno == EPROTO)) {}
  if (fd >= 0) {
    *out = fsh_socket_new(fd);
    if (listener->tls && !listener->tls_ops->accepted(listener, *out)) {
      fsh_rt_socket_release(*out);
      return fsh_io_parts(message, "can't start TLS on a new connection", "ENOMEM", "accept", NULL);
    }
    return 1;
  }
  if (errno == EAGAIN || errno == EWOULDBLOCK) {
    fsh_io_wait(listener->fd, 0, task);
    fsh_task_wait(task, "tcp.accept", 0);
    return 0;
  }
  return fsh_io_failed(message, "can't accept a connection", "accept");
}

// A task's wait on a socket was aborted: it is no longer woken when the socket is ready. A
// connect aborted before its first poll has no socket yet.
void fsh_rt_socket_leave(fsh_socket *s, fsh_task *task) {
  if (!s) return;
  fsh_connect_untimed(s, task);
  if (s->sim) {
    fsh_waiters *w = &s->sim->waiters;
    for (int64_t i = 0; i < w->count;) {
      if (w->tasks[i].task != task) { i++; continue; }
      memmove(w->tasks + i, w->tasks + i + 1, (size_t)(--w->count - i) * sizeof(fsh_waiter));
      fsh_task_release(task);
    }
    return;
  }
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
    return fsh_io_parts(message, text, "EINVAL", "read", NULL);
  }
  if (s->tls) {
    int32_t r = s->tls_ops->read(s, max, task, out, message);
    if (r == 0) fsh_task_wait(task, "tcp.read", 0);
    return r;
  }
  if (s->sim) {
    fsh_sim_sock *st = s->sim;
    if (st->rx_len > 0) {
      int64_t n = st->rx_len < max ? st->rx_len : max;
      char *data = fsh_rt_alloc(n);
      memcpy(data, st->rx + st->rx_head, (size_t)n);
      st->rx_head += n;
      st->rx_len -= n;
      if (st->rx_len == 0) st->rx_head = 0;
      *out = (fsh_array){ data, n, n };
      return 1;
    }
    if (st->peer_reset) {
      errno = ECONNRESET;
      return fsh_io_failed(message, "can't read", "read");
    }
    if (st->peer_eof || !st->peer) {
      *out = (fsh_array){ NULL, 0, 0 };
      return 1;
    }
    fsh_wait_on(&st->waiters, task, s);
    fsh_task_wait(task, "tcp.read", 0);
    return 0;
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
    fsh_task_wait(task, "tcp.read", 0);
    return 0;
  }
  return fsh_io_failed(message, "can't read", "read");
}

// Polls 'write(bytes)': sends what is left past *written, waiting while the socket is full.
int32_t fsh_rt_tcp_write(fsh_socket *s, fsh_array *bytes, int64_t *written, fsh_task *task, fsh_str **message) {
  if (s->tls) {
    int32_t r = s->tls_ops->write(s, bytes, written, task, message);
    if (r == 0) fsh_task_wait(task, "tcp.write", 0);
    return r;
  }
  if (s->sim) {
    fsh_sim_sock *st = s->sim;
    if (st->closed || st->peer_reset) {
      errno = ECONNRESET;
      return fsh_io_failed(message, "can't write", "write");
    }
    if (!st->peer || st->peer->closed) {
      errno = EPIPE;
      return fsh_io_failed(message, "can't write", "write");
    }
    if (*written < bytes->length) {
      int64_t len = bytes->length - *written;
      int64_t at = fsh_sim_next_deliver_at(st);
      if (fsh_sim_is_partitioned(st->host, st->port, st->peer->host, st->peer->port)) {
        st->peer_reset = 1;
        fsh_sim_sock_retain(st->peer);
        fsh_sim_event_push((fsh_sim_event){ at, 0, FSH_SIM_EV_RESET, 0, st->peer, NULL, NULL, 0 });
        errno = EHOSTUNREACH;
        return fsh_io_failed(message, "can't write", "write");
      }
      if (fsh_sim_should_drop()) {
        st->peer_reset = 1;
        fsh_sim_sock_retain(st->peer);
        fsh_sim_event_push((fsh_sim_event){ at, 0, FSH_SIM_EV_RESET, 0, st->peer, NULL, NULL, 0 });
        errno = ECONNRESET;
        return fsh_io_failed(message, "can't write", "write");
      }
      uint8_t *buf = malloc((size_t)len);
      memcpy(buf, bytes->data + *written, (size_t)len);
      fsh_sim_sock_retain(st->peer);
      fsh_sim_event_push((fsh_sim_event){ at, 0, FSH_SIM_EV_DATA, 0, st->peer, NULL, buf, len });
      *written = bytes->length;
    }
    return 1;
  }
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
      fsh_task_wait(task, "tcp.write", 0);
      return 0;
    }
    return fsh_io_failed(message, "can't write", "write");
  }
  return 1;
}

// Starts connecting a new socket to an address, into *socket_at, or 5 with the reason.
static int32_t fsh_connect_start(fsh_socket **socket_at, struct sockaddr_storage *at, fsh_str **message) {
  int fd = socket(at->ss_family, SOCK_STREAM | FSH_SOCK_CLOEXEC, 0);
  if (fd < 0) return fsh_io_failed(message, "can't make a socket", "socket");
  *socket_at = fsh_socket_new(fd);
  // Interrupted, it goes on connecting all the same.
  if (connect(fd, (struct sockaddr *)at, FSH_ADDRESS_SIZE(at)) < 0 && errno != EINPROGRESS && errno != EINTR) return fsh_io_failed(message, "can't connect", "connect");
  return 0;
}

// RFC 8305's Connection Attempt Delay: how long an address with others after it is given.
#define FSH_ATTEMPT_DELAY 250000000

// Starts connecting to a lookup's addresses from the n-th on, in place of the socket at
// *socket_at, skipping those that fail at once. The socket keeps the job, so a connect that fails
// later, or isn't done by its deadline, moves on to the next; with none left, 5 with the last
// one's reason. The last address has no deadline but the system's.
static int32_t fsh_connect_from(fsh_socket **socket_at, fsh_file_job *job, int32_t n, int64_t port, fsh_task *task, fsh_str **message) {
  int32_t count = (int32_t)(job->data.length / sizeof(struct sockaddr_storage));
  for (; n < count; n++) {
    fsh_rt_socket_release(*socket_at);
    *socket_at = NULL;
    struct sockaddr_storage *at = (struct sockaddr_storage *)job->data.data + n;
    fsh_address_port(at, port);
    fsh_str *skipped[4] = { NULL };
    if (!fsh_connect_start(socket_at, at, n + 1 < count ? skipped : message)) {
      (*socket_at)->lookup = job;
      (*socket_at)->tried = n;
      if (n + 1 < count) {
        (*socket_at)->deadline = fsh_now() + FSH_ATTEMPT_DELAY;
        __atomic_fetch_add(&task->refs, 1, __ATOMIC_RELAXED);
        fsh_timer_add((*socket_at)->deadline, task, NULL, *socket_at);
      }
      return 0;
    }
    for (int i = 0; i < 4; i++) fsh_rt_str_release(skipped[i]);
  }
  fsh_rt_file_job_release(job);
  return 5;
}

// Polls 'TcpStream.connect(host, port)': the frame keeps the socket while it connects; once
// writable, the connection either stands, moving the socket out, or failed. A host that isn't an
// IP address is looked up on the blocking pool first, the socket waiting with no descriptor; a
// connect dropped mid-lookup leaves the job to the pool's thread, which drops its result. Each
// address is tried in turn until one connects, an attempt not done in 250 ms abandoned for the
// next. ponytail: sequential Happy Eyeballs; RFC 8305 keeps the slow attempt going alongside the
// next, so a slow but working first address can lose to the second here.
int32_t fsh_rt_tcp_connect(fsh_socket **socket_at, fsh_str *host, int64_t port, fsh_task *task, fsh_socket **out, fsh_str **message) {
  fsh_sim_init();
  if (fsh_sim_active) {
    fsh_socket *s = *socket_at;
    if (!s) {
      char target_host[64];
      char *raw_host = fsh_rt_str_cstring(host);
      int is_localhost = raw_host && strcmp(raw_host, "localhost") == 0;
      fsh_rt_free(raw_host);
      if (!fsh_sim_normalize_host(host, port, target_host, 1, message)) return 5;
      fsh_sim_sock *l = port > 0 ? fsh_sim_listener_find(target_host, (uint16_t)port) : NULL;
      if (!l && is_localhost && port > 0) {
        fsh_sim_sock *l6 = fsh_sim_listener_find("::1", (uint16_t)port);
        if (l6) {
          l = l6;
          snprintf(target_host, sizeof target_host, "::1");
        }
      }
      const char *local_host = strchr(target_host, ':') != NULL ? "::1" : "127.0.0.1";
      uint16_t local_port = fsh_sim_alloc_port(local_host);
      if (local_port == 0) {
        errno = EADDRNOTAVAIL;
        return fsh_io_failed(message, "can't connect", "connect");
      }
      s = *socket_at = fsh_sim_socket_new(1, local_host, local_port);
      fsh_sim_sock *cli = s->sim;
      snprintf(cli->peer_host, sizeof cli->peer_host, "%s", target_host);
      cli->peer_port = (uint16_t)port;
      cli->connect_state = 1;
      int64_t delay_ns = fsh_sim_sample_delay_ns();
      int64_t at = fsh_sim_now_ns + delay_ns;
      int64_t min_fail_at = fsh_sim_now_ns > INT64_MAX - 1000000LL ? INT64_MAX : fsh_sim_now_ns + 1000000LL;
      int part = l && (fsh_sim_is_partitioned(cli->host, cli->port, l->host, l->port) || fsh_sim_is_partitioned(cli->host, cli->port, target_host, (uint16_t)port));
      if (!l) {
        fsh_sim_sock_retain(cli);
        fsh_sim_event_push((fsh_sim_event){ at, 0, FSH_SIM_EV_CONN_FAIL, ECONNREFUSED, cli, NULL, NULL, 0 });
      } else if (part) {
        int64_t fail_at = delay_ns > 0 ? at : min_fail_at;
        fsh_sim_sock_retain(cli);
        fsh_sim_event_push((fsh_sim_event){ fail_at, 0, FSH_SIM_EV_CONN_FAIL, EHOSTUNREACH, cli, NULL, NULL, 0 });
      } else if (fsh_sim_should_drop()) {
        int64_t fail_at = delay_ns > 0 ? at : min_fail_at;
        fsh_sim_sock_retain(cli);
        fsh_sim_event_push((fsh_sim_event){ fail_at, 0, FSH_SIM_EV_CONN_FAIL, ECONNRESET, cli, NULL, NULL, 0 });
      } else {
        fsh_socket *srv_sock = fsh_sim_socket_new(1, target_host, l->port);
        fsh_sim_sock *srv = srv_sock->sim;
        snprintf(srv->peer_host, sizeof srv->peer_host, "%s", cli->host);
        srv->peer_port = cli->port;
        srv->connect_state = 0;
        cli->peer = srv;
        fsh_sim_sock_retain(srv);
        srv->peer = cli;
        fsh_sim_sock_retain(cli);
        fsh_sim_sock_retain(l);
        fsh_sim_event_push((fsh_sim_event){ at, 0, FSH_SIM_EV_ACCEPT, 0, l, srv_sock, NULL, 0 });
      }
      fsh_wait_on(&cli->waiters, task, s);
      fsh_task_wait(task, "tcp.connect", 0);
      return 0;
    }
    fsh_sim_sock *cli = s->sim;
    if (cli->connect_state == 1) {
      fsh_wait_on(&cli->waiters, task, s);
      fsh_task_wait(task, "tcp.connect", 0);
      return 0;
    }
    if (cli->connect_state == 2) {
      errno = cli->connect_errno;
      return fsh_io_failed(message, "can't connect", "connect");
    }
    *out = s;
    *socket_at = NULL;
    return 1;
  }
  fsh_socket *s = *socket_at;
  if (!s) {
    struct sockaddr_storage at;
    if (fsh_address(host, port, &at, NULL)) {
      if (fsh_connect_start(socket_at, &at, message)) return 5;
    } else {
      char *name = fsh_rt_str_cstring(host);
      if (port < 0 || port > 65535 || !name) {
        fsh_rt_free(name);
        fsh_address(host, port, &at, message);
        return 5;
      }
      fsh_file_job *job = fsh_rt_alloc(sizeof(fsh_file_job));
      memset(job, 0, sizeof *job);
      job->refs = 2;
      job->op = 2;
      job->path = name;
      __atomic_fetch_add(&task->refs, 1, __ATOMIC_RELAXED);
      job->task = task;
      s = *socket_at = fsh_rt_alloc(sizeof(fsh_socket));
      memset(s, 0, sizeof *s);
      s->count = 1;
      s->fd = -1;
      s->lookup = job;
      fsh_pool_submit(job);
      fsh_task_wait(task, "dns", 0);
      return 0;
    }
  } else if (s->fd < 0) {
    fsh_file_job *job = s->lookup;
    if (!fsh_job_done(job, task)) {
      fsh_task_wait(task, "dns", 0);
      return 0;
    }
    if (job->error) {
      // A name with no address is ENOTFOUND, a resolver that couldn't answer EAI_AGAIN.
      const char *code = job->error == EAI_AGAIN ? "EAI_AGAIN" : "ENOTFOUND";
      size_t size = strlen(job->path) + 32;
      char *text = fsh_rt_alloc(size);
      snprintf(text, size, "getaddrinfo %s %s", code, job->path);
      fsh_io_parts(message, text, code, "getaddrinfo", NULL);
      fsh_rt_free(text);
      return 5;
    }
    s->lookup = NULL;
    if (fsh_connect_from(socket_at, job, 0, port, task, message)) return 5;
  }
  for (;;) {
    s = *socket_at;
    int error = 0;
    socklen_t size = sizeof error;
    getsockopt(s->fd, SOL_SOCKET, SO_ERROR, &error, &size);
    if (!error) {
      struct sockaddr_storage peer;
      socklen_t peer_size = sizeof peer;
      if (getpeername(s->fd, (struct sockaddr *)&peer, &peer_size) == 0) break;
      if (errno == ENOTCONN && (!s->deadline || fsh_now() < s->deadline)) {
        fsh_io_wait(s->fd, 1, task);
        fsh_task_wait(task, "tcp.connect", 0);
        return 0;
      }
      // Past its deadline the attempt gives way to the next address. A refusal that lands after
      // SO_ERROR was read shows on macOS as getpeername's EINVAL, with SO_ERROR holding the reason.
      error = errno == ENOTCONN ? ETIMEDOUT : errno;
      int late = 0;
      getsockopt(s->fd, SOL_SOCKET, SO_ERROR, &late, &size);
      if (late) error = late;
    }
    fsh_connect_untimed(s, task);
    fsh_file_job *job = s->lookup;
    if (!job || (int64_t)(s->tried + 1) * (int64_t)sizeof(struct sockaddr_storage) >= job->data.length) {
      errno = error;
      return fsh_io_failed(message, "can't connect", "connect");
    }
    s->lookup = NULL;
    if (fsh_connect_from(socket_at, job, s->tried + 1, port, task, message)) return 5;
  }
  fsh_connect_untimed(s, task);
  fsh_rt_file_job_release(s->lookup);
  s->lookup = NULL;
  *out = s;
  *socket_at = NULL;
  return 1;
}

// A socket call's failure on a path, which the IoError names.
static int32_t fsh_unix_failed(fsh_str **message, const char *doing, const char *syscall, const char *path) {
  int32_t failed = fsh_io_failed(message, doing, syscall);
  message[3] = fsh_rt_str_from_cstring(path);
  return failed;
}

// A socket path as an address, or NULL with the reason in message. Abstract names start with a
// NUL byte, so they are refused with every other path holding one.
static char *fsh_unix_address(fsh_str *path, struct sockaddr_un *at, const char *syscall, fsh_str **message) {
  char *text = fsh_rt_str_cstring(path);
  char reason[160];
  reason[0] = 0;
  if (!text) snprintf(reason, sizeof reason, "a socket path can't hold a NUL byte; abstract socket names aren't supported");
  else if (!text[0]) snprintf(reason, sizeof reason, "the socket path is empty");
  else if (strlen(text) >= sizeof at->sun_path) snprintf(reason, sizeof reason, "the socket path is %zu bytes, but the system takes at most %zu", strlen(text), sizeof at->sun_path - 1);
  if (reason[0]) {
    fsh_io_parts(message, reason, text && text[0] ? "ENAMETOOLONG" : "EINVAL", syscall, text);
    fsh_rt_free(text);
    return NULL;
  }
  memset(at, 0, sizeof *at);
  at->sun_family = AF_UNIX;
  memcpy(at->sun_path, text, strlen(text));
  return text;
}

// 'UnixListener.bind(path)': listening at once, or 5 with the reason. A file already at the path
// is the system's EADDRINUSE: it is never removed to make room.
int32_t fsh_rt_unix_bind(fsh_str *path, fsh_socket **out, fsh_str **message) {
  fsh_sim_init();
  if (fsh_sim_active) {
    errno = ENOTSUP;
    return fsh_io_failed(message, "Unix sockets are not supported in simulation mode", "listen");
  }
  struct sockaddr_un at;
  char *text = fsh_unix_address(path, &at, "listen", message);
  if (!text) return 5;
  int fd = socket(AF_UNIX, SOCK_STREAM | FSH_SOCK_CLOEXEC, 0);
  int32_t failed = 0;
  if (fd < 0) failed = fsh_unix_failed(message, "can't make a socket", "socket", text);
  else if (bind(fd, (struct sockaddr *)&at, sizeof at) < 0 || listen(fd, 128) < 0) {
    failed = fsh_unix_failed(message, "can't listen there", "listen", text);
    close(fd);
  }
  fsh_rt_free(text);
  if (failed) return failed;
  *out = fsh_socket_new(fd);
  return 1;
}

// Polls 'UnixStream.connect(path)': the frame keeps the socket while it connects. A listener with
// a full backlog is the system's EAGAIN on Linux, given as is.
int32_t fsh_rt_unix_connect(fsh_socket **socket_at, fsh_str *path, fsh_task *task, fsh_socket **out, fsh_str **message) {
  fsh_sim_init();
  if (fsh_sim_active) {
    errno = ENOTSUP;
    return fsh_io_failed(message, "Unix sockets are not supported in simulation mode", "connect");
  }
  fsh_socket *s = *socket_at;
  struct sockaddr_un at;
  char *text = fsh_unix_address(path, &at, "connect", message);
  if (!text) return 5;
  int32_t failed = 0;
  if (!s) {
    int fd = socket(AF_UNIX, SOCK_STREAM | FSH_SOCK_CLOEXEC, 0);
    if (fd < 0) failed = fsh_unix_failed(message, "can't make a socket", "socket", text);
    else {
      s = *socket_at = fsh_socket_new(fd);
      if (connect(fd, (struct sockaddr *)&at, sizeof at) < 0) {
        if (errno == EINPROGRESS || errno == EINTR) {
          fsh_io_wait(fd, 1, task);
          fsh_task_wait(task, "unix.connect", 0);
          fsh_rt_free(text);
          return 0;
        }
        failed = fsh_unix_failed(message, "can't connect", "connect", text);
      }
    }
  } else {
    int error = 0;
    socklen_t size = sizeof error;
    getsockopt(s->fd, SOL_SOCKET, SO_ERROR, &error, &size);
    if (error) {
      errno = error;
      failed = fsh_unix_failed(message, "can't connect", "connect", text);
    }
  }
  fsh_rt_free(text);
  if (failed) return failed;
  *out = s;
  *socket_at = NULL;
  return 1;
}

// serve's socket file, removed once it stops listening.
void fsh_rt_unix_unlink(fsh_str *path) {
  char *text = fsh_rt_str_cstring(path);
  if (text) unlink(text);
  fsh_rt_free(text);
}

// A datagram's address, as fsh_address reads it, with the failing call named; an IPv4 address
// meant for a socket bound to IPv6 is mapped, as "::" takes IPv4 peers too.
static int fsh_udp_address(fsh_socket *s, fsh_str *host, int64_t port, struct sockaddr_storage *at, const char *syscall, fsh_str **message) {
  if (!fsh_address(host, port, at, message)) {
    fsh_rt_str_release(message[2]);
    message[2] = fsh_rt_str_from_cstring(syscall);
    return 0;
  }
  struct sockaddr_storage own;
  socklen_t size = sizeof own;
  if (!s || at->ss_family != AF_INET || getsockname(s->fd, (struct sockaddr *)&own, &size) < 0 || own.ss_family != AF_INET6) return 1;
  struct sockaddr_in v4 = *(struct sockaddr_in *)at;
  struct sockaddr_in6 *v6 = (struct sockaddr_in6 *)at;
  memset(at, 0, sizeof *at);
  v6->sin6_family = AF_INET6;
  v6->sin6_port = v4.sin_port;
  v6->sin6_addr.s6_addr[10] = v6->sin6_addr.s6_addr[11] = 0xff;
  memcpy(&v6->sin6_addr.s6_addr[12], &v4.sin_addr, 4);
  return 1;
}

// 'UdpSocket.bind(host, port)': bound at once, or 5 with the reason.
int32_t fsh_rt_udp_bind(fsh_str *host, int64_t port, fsh_socket **out, fsh_str **message) {
  fsh_sim_init();
  if (fsh_sim_active) {
    errno = ENOTSUP;
    return fsh_io_failed(message, "UDP sockets are not supported in simulation mode", "bind");
  }
  struct sockaddr_storage at;
  if (!fsh_udp_address(NULL, host, port, &at, "bind", message)) return 5;
  int fd = socket(at.ss_family, SOCK_DGRAM | FSH_SOCK_CLOEXEC, 0);
  if (fd < 0) return fsh_io_failed(message, "can't make a socket", "socket");
  int off = 0, room = 0, most = 65536;
  if (at.ss_family == AF_INET6) setsockopt(fd, IPPROTO_IPV6, IPV6_V6ONLY, &off, sizeof off);
  // macOS sends no datagram larger than its send buffer, which starts at 9216 bytes: raised so any
  // UDP payload goes, as on Linux.
  socklen_t size = sizeof room;
  if (getsockopt(fd, SOL_SOCKET, SO_SNDBUF, &room, &size) == 0 && room < most) setsockopt(fd, SOL_SOCKET, SO_SNDBUF, &most, sizeof most);
  if (bind(fd, (struct sockaddr *)&at, FSH_ADDRESS_SIZE(&at)) < 0) {
    int32_t failed = fsh_io_failed(message, "can't bind there", "bind");
    close(fd);
    return failed;
  }
  *out = fsh_socket_new(fd);
  return 1;
}

// 'socket.connect(host, port)': only the peer is set, so it never waits.
int32_t fsh_rt_udp_connect(fsh_socket *s, fsh_str *host, int64_t port, fsh_str **message) {
  struct sockaddr_storage at;
  if (!fsh_udp_address(s, host, port, &at, "connect", message)) return 5;
  if (connect(s->fd, (struct sockaddr *)&at, FSH_ADDRESS_SIZE(&at)) < 0) return fsh_io_failed(message, "can't connect", "connect");
  return 1;
}

// Polls 'sendTo(bytes, host, port)', or 'send(bytes)' to the connected peer when host is NULL. A
// datagram goes whole or not at all, so there is no partial send to resume.
int32_t fsh_rt_udp_send(fsh_socket *s, fsh_array *bytes, fsh_str *host, int64_t port, fsh_task *task, fsh_str **message) {
  struct sockaddr_storage at;
  if (host && !fsh_udp_address(s, host, port, &at, "send", message)) return 5;
  for (;;) {
    ssize_t n = host ? sendto(s->fd, bytes->data, (size_t)bytes->length, 0, (struct sockaddr *)&at, FSH_ADDRESS_SIZE(&at)) : send(s->fd, bytes->data, (size_t)bytes->length, 0);
    if (n >= 0) return 1;
    if (errno == EINTR) continue;
    if (errno == EAGAIN || errno == EWOULDBLOCK) {
      fsh_io_wait(s->fd, 1, task);
      fsh_task_wait(task, "udp.send", 0);
      return 0;
    }
    return fsh_io_failed(message, "can't send", "send");
  }
}

// Polls 'receiveFrom()' and 'receive()': one datagram's bytes, exactly, and with host not NULL
// the sender's address, unbracketed.
int32_t fsh_rt_udp_receive(fsh_socket *s, fsh_task *task, fsh_array *out, fsh_str **host, int64_t *port, fsh_str **message) {
  // 65536 bytes hold the largest UDP payload, so no datagram is cut short.
  char buffer[65536];
  struct sockaddr_storage from;
  for (;;) {
    socklen_t size = sizeof from;
    ssize_t n = recvfrom(s->fd, buffer, sizeof buffer, 0, (struct sockaddr *)&from, &size);
    if (n >= 0) {
      char *data = n ? fsh_rt_alloc(n) : NULL;
      if (n) memcpy(data, buffer, n);
      *out = (fsh_array){data, n, n};
      if (host) {
        char text[INET6_ADDRSTRLEN] = "";
        int v6 = from.ss_family == AF_INET6;
        inet_ntop(from.ss_family, v6 ? (void *)&((struct sockaddr_in6 *)&from)->sin6_addr : (void *)&((struct sockaddr_in *)&from)->sin_addr, text, sizeof text);
        *host = fsh_rt_str_from_cstring(text);
        *port = ntohs(v6 ? ((struct sockaddr_in6 *)&from)->sin6_port : ((struct sockaddr_in *)&from)->sin_port);
      }
      return 1;
    }
    if (errno == EINTR) continue;
    if (errno == EAGAIN || errno == EWOULDBLOCK) {
      fsh_io_wait(s->fd, 0, task);
      fsh_task_wait(task, "udp.receive", 0);
      return 0;
    }
    return fsh_io_failed(message, "can't receive", "recvfrom");
  }
}

// Another reference to a JoinHandle's task, where the compiler copies one it then drops.
void fsh_rt_handle_retain(fsh_task *t) {
  if (t) __atomic_fetch_add(&t->refs, 1, __ATOMIC_RELAXED);
}

// Drops a JoinHandle: its task runs on, detached, until it is done or the runtime stops.
void fsh_rt_handle_drop(fsh_task *t) {
  if (t) fsh_task_release(t);
}

// Task inspector: thread-safe live snapshots of active tasks formatted as JSON, plain text, or
// HTML. Every internal buffer uses malloc/free so inspecting never triggers runtime leak counts.
typedef struct {
  int64_t id;
  const char *name;
  int32_t state;
  int32_t blocking;
  const char *awaiting;
  const char *await_site;
  int64_t await_target;
  int64_t age_ms;
  const char *spawn_site;
  int64_t polls;
} fsh_task_snap;

typedef struct { char *data; size_t len, cap; int failed; } fsh_buf;

static void fsh_buf_grow(fsh_buf *b, size_t need) {
  if (b->failed) return;
  if (need > SIZE_MAX - b->len - 1) {
    free(b->data);
    b->data = NULL;
    b->len = b->cap = 0;
    b->failed = 1;
    return;
  }
  size_t required = b->len + need + 1;
  if (required <= b->cap) return;
  size_t cap = b->cap ? b->cap : 256;
  while (cap < required) {
    if (cap > SIZE_MAX / 2) { cap = required; break; }
    cap *= 2;
  }
  char *next = realloc(b->data, cap);
  if (!next) {
    free(b->data);
    b->data = NULL;
    b->len = b->cap = 0;
    b->failed = 1;
    return;
  }
  b->data = next;
  b->cap = cap;
}

static void fsh_buf_putn(fsh_buf *b, const char *s, size_t n) {
  fsh_buf_grow(b, n);
  if (b->failed || !b->data) return;
  memcpy(b->data + b->len, s, n);
  b->len += n;
  b->data[b->len] = 0;
}

static void fsh_buf_puts(fsh_buf *b, const char *s) {
  if (s) fsh_buf_putn(b, s, strlen(s));
}

static void fsh_buf_printf(fsh_buf *b, const char *fmt, ...) {
  char tmp[256];
  va_list ap, ap2;
  va_start(ap, fmt);
  va_copy(ap2, ap);
  int n = vsnprintf(tmp, sizeof tmp, fmt, ap);
  va_end(ap);
  if (n >= 0 && (size_t)n < sizeof tmp) {
    fsh_buf_putn(b, tmp, (size_t)n);
  } else if (n > 0) {
    char *big = malloc((size_t)n + 1);
    if (big) {
      vsnprintf(big, (size_t)n + 1, fmt, ap2);
      fsh_buf_putn(b, big, (size_t)n);
      free(big);
    }
  }
  va_end(ap2);
}

static void fsh_buf_json(fsh_buf *b, const char *s) {
  fsh_buf_putn(b, "\"", 1);
  if (s) {
    for (const unsigned char *p = (const unsigned char *)s; *p; p++) {
      if (*p == '"') fsh_buf_putn(b, "\\\"", 2);
      else if (*p == '\\') fsh_buf_putn(b, "\\\\", 2);
      else if (*p == '\n') fsh_buf_putn(b, "\\n", 2);
      else if (*p == '\r') fsh_buf_putn(b, "\\r", 2);
      else if (*p == '\t') fsh_buf_putn(b, "\\t", 2);
      else if (*p < 0x20) fsh_buf_printf(b, "\\u%04x", (unsigned)*p);
      else fsh_buf_putn(b, (const char *)p, 1);
    }
  }
  fsh_buf_putn(b, "\"", 1);
}

static void fsh_buf_html(fsh_buf *b, const char *s) {
  if (!s) return;
  for (const char *p = s; *p; p++) {
    if (*p == '&') fsh_buf_puts(b, "&amp;");
    else if (*p == '<') fsh_buf_puts(b, "&lt;");
    else if (*p == '>') fsh_buf_puts(b, "&gt;");
    else if (*p == '"') fsh_buf_puts(b, "&quot;");
    else fsh_buf_putn(b, p, 1);
  }
}

static int fsh_snap_cmp(const void *a, const void *b) {
  int64_t x = ((const fsh_task_snap *)a)->id;
  int64_t y = ((const fsh_task_snap *)b)->id;
  return x < y ? -1 : x > y ? 1 : 0;
}

static const char *fsh_state_label(int32_t state) {
  switch (state) {
    case FSH_RUNNING: return "running";
    case FSH_QUEUED:
    case FSH_NOTIFIED: return "runnable";
    case FSH_IDLE: return "waiting";
    default: return "done";
  }
}

static void fsh_await_label(char *out, size_t size, const fsh_task_snap *s) {
  if (!s->awaiting || !s->awaiting[0]) {
    out[0] = 0;
    return;
  }
  if (s->await_target > 0) snprintf(out, size, "%s #%lld", s->awaiting, (long long)s->await_target);
  else snprintf(out, size, "%s", s->awaiting);
}

// Copies every alive task's metadata under fsh_alive_lock, then sorts by task id.
static fsh_task_snap *fsh_tasks_snapshot(int64_t *count_out) {
  pthread_mutex_lock(&fsh_alive_lock);
  int64_t n = 0;
  for (fsh_task *t = fsh_alive; t; t = t->next) n++;
  fsh_task_snap *snaps = n > 0 ? malloc((size_t)n * sizeof(fsh_task_snap)) : NULL;
  int64_t now = fsh_now();
  int64_t i = 0;
  if (snaps) {
    for (fsh_task *t = fsh_alive; t && i < n; t = t->next, i++) {
      int32_t state = __atomic_load_n(&t->state, __ATOMIC_ACQUIRE);
      const char *awaiting = NULL;
      const char *await_site = NULL;
      int64_t target = 0;
      if (state == FSH_IDLE) {
        for (int tries = 0; tries < 8; tries++) {
          uint32_t s1 = __atomic_load_n(&t->wait_seq, __ATOMIC_ACQUIRE);
          if (s1 & 1u) continue;
          const char *w = __atomic_load_n(&t->awaiting, __ATOMIC_RELAXED);
          const char *as = __atomic_load_n(&t->await_site, __ATOMIC_RELAXED);
          int64_t tg = __atomic_load_n(&t->await_target, __ATOMIC_RELAXED);
          __atomic_thread_fence(__ATOMIC_ACQUIRE);
          uint32_t s2 = __atomic_load_n(&t->wait_seq, __ATOMIC_RELAXED);
          if (s1 == s2) {
            awaiting = w;
            await_site = as;
            target = tg;
            break;
          }
        }
      }
      int64_t age = now >= t->created_ns ? (now - t->created_ns) / 1000000 : 0;
      snaps[i] = (fsh_task_snap){
        t->id,
        t->name ? t->name : "",
        state,
        t->blocking,
        awaiting,
        await_site,
        target,
        age,
        t->spawn_site,
        __atomic_load_n(&t->polls, __ATOMIC_RELAXED),
      };
    }
  }
  pthread_mutex_unlock(&fsh_alive_lock);
  if (snaps && i > 1) qsort(snaps, (size_t)i, sizeof(fsh_task_snap), fsh_snap_cmp);
  *count_out = i;
  return snaps;
}

char *fsh_rt_tasks_json(void) {
  int64_t n = 0;
  fsh_task_snap *snaps = fsh_tasks_snapshot(&n);
  fsh_buf b = { NULL, 0, 0 };
  fsh_buf_puts(&b, "[");
  for (int64_t i = 0; i < n; i++) {
    if (i > 0) fsh_buf_puts(&b, ",");
    char await_text[96];
    fsh_await_label(await_text, sizeof await_text, &snaps[i]);
    fsh_buf_printf(&b, "{\"id\":%lld,\"name\":", (long long)snaps[i].id);
    fsh_buf_json(&b, snaps[i].name);
    fsh_buf_puts(&b, ",\"state\":");
    fsh_buf_json(&b, fsh_state_label(snaps[i].state));
    fsh_buf_puts(&b, ",\"awaiting\":");
    fsh_buf_json(&b, await_text);
    fsh_buf_puts(&b, ",\"awaitSite\":");
    fsh_buf_json(&b, snaps[i].await_site ? snaps[i].await_site : "");
    fsh_buf_printf(&b, ",\"ageMs\":%lld,\"spawnSite\":", (long long)snaps[i].age_ms);
    fsh_buf_json(&b, snaps[i].spawn_site ? snaps[i].spawn_site : "");
    fsh_buf_printf(&b, ",\"blocking\":%s,\"polls\":%lld}", snaps[i].blocking ? "true" : "false", (long long)snaps[i].polls);
  }
  fsh_buf_puts(&b, "]");
  free(snaps);
  return b.data;
}

char *fsh_rt_tasks_table(void) {
  int64_t n = 0;
  fsh_task_snap *snaps = fsh_tasks_snapshot(&n);
  fsh_buf b = { NULL, 0, 0 };
  if (n == 0) {
    fsh_buf_puts(&b, "no live tasks\n");
    free(snaps);
    return b.data;
  }
  fsh_buf_printf(&b, "%-6s %-9s %-10s %-7s %-18s %-24s %s\n", "ID", "STATE", "AGE", "POLLS", "AWAITING", "NAME", "SPAWN SITE");
  for (int64_t i = 0; i < n; i++) {
    char await_text[96];
    fsh_await_label(await_text, sizeof await_text, &snaps[i]);
    char age_text[32];
    snprintf(age_text, sizeof age_text, "%lldms", (long long)snaps[i].age_ms);
    const char *what = await_text[0] ? await_text : "-";
    const char *name = snaps[i].name[0] ? snaps[i].name : "-";
    const char *site = snaps[i].spawn_site && snaps[i].spawn_site[0] ? snaps[i].spawn_site : "-";
    fsh_buf_printf(&b, "%-6lld %-9s %-10s %-7lld %-18s %-24s %s\n",
      (long long)snaps[i].id, fsh_state_label(snaps[i].state), age_text, (long long)snaps[i].polls, what, name, site);
  }
  free(snaps);
  return b.data;
}

void fsh_rt_tasks_free(char *p) {
  free(p);
}

static char *fsh_tasks_html(void) {
  int64_t n = 0;
  fsh_task_snap *snaps = fsh_tasks_snapshot(&n);
  fsh_buf b = { NULL, 0, 0 };
  fsh_buf_puts(&b,
    "<!doctype html><html><head><meta charset=\"utf-8\">"
    "<title>Fish Task Inspector</title>"
    "<noscript><meta http-equiv=\"refresh\" content=\"1\"></noscript>"
    "<style>"
    "body{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin:20px;color:#111;background:#fafafa}"
    "h1{font-size:16px;margin:0 0 8px}p{font-size:12px;color:#555;margin:0 0 12px}"
    "table{border-collapse:collapse;width:100%;font-size:13px;background:#fff}"
    "th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}"
    "th{background:#f0f0f0}"
    "</style></head><body>"
    "<h1>Fish Task Inspector</h1>"
    "<p id=\"meta\">");
  fsh_buf_printf(&b, "%lld live task%s</p>", (long long)n, n == 1 ? "" : "s");
  fsh_buf_puts(&b,
    "<table><thead><tr>"
    "<th>ID</th><th>State</th><th>Age</th><th>Polls</th><th>Awaiting</th><th>Await Site</th><th>Name</th><th>Spawn Site</th><th>Pool</th>"
    "</tr></thead><tbody id=\"rows\">");
  for (int64_t i = 0; i < n; i++) {
    char await_text[96];
    fsh_await_label(await_text, sizeof await_text, &snaps[i]);
    fsh_buf_printf(&b, "<tr><td>%lld</td><td>", (long long)snaps[i].id);
    fsh_buf_html(&b, fsh_state_label(snaps[i].state));
    fsh_buf_printf(&b, "</td><td>%lldms</td><td>%lld</td><td>", (long long)snaps[i].age_ms, (long long)snaps[i].polls);
    fsh_buf_html(&b, await_text[0] ? await_text : "-");
    fsh_buf_puts(&b, "</td><td>");
    fsh_buf_html(&b, snaps[i].await_site && snaps[i].await_site[0] ? snaps[i].await_site : "-");
    fsh_buf_puts(&b, "</td><td>");
    fsh_buf_html(&b, snaps[i].name[0] ? snaps[i].name : "-");
    fsh_buf_puts(&b, "</td><td>");
    fsh_buf_html(&b, snaps[i].spawn_site && snaps[i].spawn_site[0] ? snaps[i].spawn_site : "-");
    fsh_buf_puts(&b, "</td><td>");
    fsh_buf_puts(&b, snaps[i].blocking ? "blocking" : "worker");
    fsh_buf_puts(&b, "</td></tr>");
  }
  fsh_buf_puts(&b,
    "</tbody></table>"
    "<script>"
    "function cell(tr,v){var td=document.createElement('td');td.textContent=v;tr.appendChild(td);}"
    "function tick(){fetch('/tasks.json').then(function(r){return r.json();}).then(function(ts){"
    "var tb=document.getElementById('rows');tb.textContent='';"
    "document.getElementById('meta').textContent=ts.length+' live task'+(ts.length===1?'':'s');"
    "for(var i=0;i<ts.length;i++){var t=ts[i],tr=document.createElement('tr');"
    "cell(tr,String(t.id));cell(tr,t.state);cell(tr,t.ageMs+'ms');cell(tr,String(t.polls));"
    "cell(tr,t.awaiting||'-');cell(tr,t.awaitSite||'-');cell(tr,t.name||'-');"
    "cell(tr,t.spawnSite||'-');cell(tr,t.blocking?'blocking':'worker');tb.appendChild(tr);}"
    "}).catch(function(){});}"
    "setInterval(tick,500);"
    "</script></body></html>\n");
  free(snaps);
  return b.data;
}

static int fsh_inspect_fd = -1;
static int fsh_inspect_pipe[2] = { -1, -1 };
static pthread_t fsh_inspect_thread;
static int fsh_inspect_running = 0;
static int32_t fsh_inspect_stopping = 0;
static char fsh_inspect_host[64] = "127.0.0.1";

static void fsh_inspect_write_all(int fd, const char *data, size_t len, int64_t deadline) {
  size_t off = 0;
  while (off < len && !__atomic_load_n(&fsh_inspect_stopping, __ATOMIC_ACQUIRE) && fsh_now() < deadline) {
#ifdef MSG_NOSIGNAL
    ssize_t n = send(fd, data + off, len - off, MSG_NOSIGNAL);
#else
    ssize_t n = send(fd, data + off, len - off, 0);
#endif
    if (n > 0) { off += (size_t)n; continue; }
    if (n < 0 && errno == EINTR) continue;
    break;
  }
}

static void fsh_inspect_reply(int fd, const char *status, const char *type, const char *body, size_t len) {
  char head[256];
  int hlen = snprintf(head, sizeof head,
    "HTTP/1.1 %s\r\nContent-Type: %s\r\nContent-Length: %zu\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
    status, type, len);
  int64_t deadline = fsh_now() + 2000000000LL;
  if (hlen > 0 && (size_t)hlen < sizeof head) fsh_inspect_write_all(fd, head, (size_t)hlen, deadline);
  if (body && len > 0) fsh_inspect_write_all(fd, body, len, deadline);
}

static int fsh_ascii_ieq(const char *a, const char *b, size_t n) {
  for (size_t i = 0; i < n; i++) {
    unsigned char ca = (unsigned char)a[i], cb = (unsigned char)b[i];
    if (ca >= 'A' && ca <= 'Z') ca += 32;
    if (cb >= 'A' && cb <= 'Z') cb += 32;
    if (ca != cb) return 0;
  }
  return 1;
}

// Guards against DNS rebinding from untrusted browser origins by requiring Host to match
// loopback or the configured bind host.
static int fsh_inspect_host_ok(const char *req) {
  const char *p = strchr(req, '\n');
  while (p) {
    p++;
    if (*p == '\r' || *p == '\n' || !*p) break;
    if (fsh_ascii_ieq(p, "host:", 5)) {
      const char *v = p + 5;
      while (*v == ' ' || *v == '\t') v++;
      const char *e = v;
      while (*e && *e != '\r' && *e != '\n') e++;
      while (e > v && (e[-1] == ' ' || e[-1] == '\t')) e--;
      // Strip optional :port (handling bracketed IPv6 [::1]:port).
      const char *host_end = e;
      if (v < e && *v == '[') {
        const char *rb = memchr(v, ']', (size_t)(e - v));
        if (rb) host_end = rb + 1;
      } else {
        for (const char *c = v; c < e; c++) if (*c == ':') { host_end = c; break; }
      }
      size_t hlen = (size_t)(host_end - v);
      if (hlen == 9 && fsh_ascii_ieq(v, "localhost", 9)) return 1;
      if (hlen == 9 && memcmp(v, "127.0.0.1", 9) == 0) return 1;
      if (hlen == 5 && memcmp(v, "[::1]", 5) == 0) return 1;
      size_t blen = strlen(fsh_inspect_host);
      if (blen > 0 && hlen == blen && fsh_ascii_ieq(v, fsh_inspect_host, blen)) return 1;
      return 0;
    }
    p = strchr(p, '\n');
  }
  return 0;
}

static void fsh_inspect_handle(int c) {
  struct timeval tv = { 1, 0 };
  setsockopt(c, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
  setsockopt(c, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof tv);
#ifdef SO_NOSIGPIPE
  int on = 1;
  setsockopt(c, SOL_SOCKET, SO_NOSIGPIPE, &on, sizeof on);
#endif
  char req[8192];
  size_t total = 0;
  int complete = 0;
  int64_t deadline = fsh_now() + 1000000000LL;
  while (total < sizeof req - 1 && !__atomic_load_n(&fsh_inspect_stopping, __ATOMIC_ACQUIRE) && fsh_now() < deadline) {
    ssize_t n = recv(c, req + total, sizeof req - 1 - total, 0);
    if (n > 0) {
      if (memchr(req + total, 0, (size_t)n) != NULL) {
        const char *msg = "bad request\n";
        fsh_inspect_reply(c, "400 Bad Request", "text/plain; charset=utf-8", msg, strlen(msg));
        return;
      }
      total += (size_t)n;
      req[total] = 0;
      if (strstr(req, "\r\n\r\n") || strstr(req, "\n\n")) {
        complete = 1;
        break;
      }
      continue;
    }
    if (n < 0 && errno == EINTR) continue;
    break;
  }
  if (total == 0) return;
  if (!complete) {
    if (total == sizeof req - 1) {
      const char *msg = "request header fields too large\n";
      fsh_inspect_reply(c, "431 Request Header Fields Too Large", "text/plain; charset=utf-8", msg, strlen(msg));
    }
    return;
  }
  req[total] = 0;
  if (!fsh_inspect_host_ok(req)) {
    const char *msg = "forbidden host\n";
    fsh_inspect_reply(c, "403 Forbidden", "text/plain; charset=utf-8", msg, strlen(msg));
    return;
  }
  if (strncmp(req, "GET ", 4) != 0) {
    const char *msg = "method not allowed\n";
    fsh_inspect_reply(c, "405 Method Not Allowed", "text/plain; charset=utf-8", msg, strlen(msg));
    return;
  }
  char *path = req + 4;
  char *end = path;
  while (*end && *end != ' ' && *end != '?' && *end != '\r' && *end != '\n') end++;
  *end = 0;
  if (strcmp(path, "/") == 0) {
    char *html = fsh_tasks_html();
    fsh_inspect_reply(c, "200 OK", "text/html; charset=utf-8", html ? html : "", html ? strlen(html) : 0);
    free(html);
  } else if (strcmp(path, "/tasks.json") == 0 || strcmp(path, "/json") == 0) {
    char *json = fsh_rt_tasks_json();
    fsh_inspect_reply(c, "200 OK", "application/json", json ? json : "[]", json ? strlen(json) : 2);
    free(json);
  } else if (strcmp(path, "/tasks") == 0 || strcmp(path, "/text") == 0) {
    char *text = fsh_rt_tasks_table();
    fsh_inspect_reply(c, "200 OK", "text/plain; charset=utf-8", text ? text : "", text ? strlen(text) : 0);
    free(text);
  } else {
    const char *msg = "not found\n";
    fsh_inspect_reply(c, "404 Not Found", "text/plain; charset=utf-8", msg, strlen(msg));
  }
}

// Runs on a dedicated thread outside the worker pool so the inspector stays reachable even when
// every Fish worker is blocked.
static void *fsh_inspector_loop(void *arg) {
  (void)arg;
  while (!__atomic_load_n(&fsh_inspect_stopping, __ATOMIC_ACQUIRE)) {
    struct pollfd fds[2];
    fds[0].fd = fsh_inspect_fd;
    fds[0].events = POLLIN;
    fds[0].revents = 0;
    fds[1].fd = fsh_inspect_pipe[0];
    fds[1].events = POLLIN;
    fds[1].revents = 0;
    int r = poll(fds, 2, -1);
    if (r < 0) {
      if (errno == EINTR) continue;
      break;
    }
    if (fds[1].revents & (POLLIN | POLLHUP | POLLERR)) break;
    if (fds[0].revents & POLLIN) {
      while (!__atomic_load_n(&fsh_inspect_stopping, __ATOMIC_ACQUIRE)) {
        int c = FSH_ACCEPT(fsh_inspect_fd);
        if (c < 0) {
          if (errno == EINTR || errno == ECONNABORTED || errno == EPROTO) continue;
          break;
        }
        int fl = fcntl(c, F_GETFL, 0);
        if (fl >= 0) fcntl(c, F_SETFL, fl & ~O_NONBLOCK);
        fcntl(c, F_SETFD, FD_CLOEXEC);
        fsh_inspect_handle(c);
        shutdown(c, SHUT_WR);
        close(c);
      }
    }
  }
  return NULL;
}

static int fsh_inspect_parse_port(const char *s, int *out) {
  if (!s || !s[0]) return 0;
  long v = 0;
  for (const char *p = s; *p; p++) {
    if (*p < '0' || *p > '9') return 0;
    v = v * 10 + (*p - '0');
    if (v > 65535) return 0;
  }
  *out = (int)v;
  return 1;
}

static void fsh_inspector_start(void) {
  const char *spec = getenv("FISH_INSPECT");
  if (!spec || !spec[0] || strcmp(spec, "0") == 0 || strcmp(spec, "false") == 0) return;
  char host[64] = "127.0.0.1";
  int port = 9229;
  if (strcmp(spec, "1") == 0 || strcmp(spec, "true") == 0) {
    // Default loopback address and port.
  } else if (fsh_inspect_parse_port(spec, &port)) {
    // Port-only shorthand binds loopback.
  } else {
    const char *colon = strrchr(spec, ':');
    if (!colon || colon == spec || (size_t)(colon - spec) >= sizeof host || !fsh_inspect_parse_port(colon + 1, &port)) {
      fprintf(stderr, "fish inspector: invalid FISH_INSPECT '%s' (expected 1, <port>, or <host>:<port>)\n", spec);
      return;
    }
    memcpy(host, spec, (size_t)(colon - spec));
    host[colon - spec] = 0;
    if (strcmp(host, "localhost") == 0) strcpy(host, "127.0.0.1");
  }
  struct sockaddr_in addr;
  memset(&addr, 0, sizeof addr);
  addr.sin_family = AF_INET;
  addr.sin_port = htons((uint16_t)port);
  if (inet_pton(AF_INET, host, &addr.sin_addr) != 1) {
    fprintf(stderr, "fish inspector: invalid FISH_INSPECT host '%s'\n", host);
    return;
  }
  if (pipe(fsh_inspect_pipe) != 0) {
    fprintf(stderr, "fish inspector: failed to create wakeup pipe\n");
    return;
  }
  fcntl(fsh_inspect_pipe[0], F_SETFD, FD_CLOEXEC);
  fcntl(fsh_inspect_pipe[1], F_SETFD, FD_CLOEXEC);
  fcntl(fsh_inspect_pipe[0], F_SETFL, O_NONBLOCK);
  fcntl(fsh_inspect_pipe[1], F_SETFL, O_NONBLOCK);
  int fd = socket(AF_INET, SOCK_STREAM | FSH_SOCK_CLOEXEC, 0);
  if (fd < 0) {
    fprintf(stderr, "fish inspector: failed to create socket\n");
    close(fsh_inspect_pipe[0]);
    close(fsh_inspect_pipe[1]);
    fsh_inspect_pipe[0] = fsh_inspect_pipe[1] = -1;
    return;
  }
  fcntl(fd, F_SETFD, FD_CLOEXEC);
  fcntl(fd, F_SETFL, O_NONBLOCK);
  int on = 1;
  setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, sizeof on);
  if (bind(fd, (struct sockaddr *)&addr, sizeof addr) != 0 || listen(fd, 16) != 0) {
    fprintf(stderr, "fish inspector: failed to listen on %s:%d (%s)\n", host, port, strerror(errno));
    close(fd);
    close(fsh_inspect_pipe[0]);
    close(fsh_inspect_pipe[1]);
    fsh_inspect_pipe[0] = fsh_inspect_pipe[1] = -1;
    return;
  }
  socklen_t alen = sizeof addr;
  int bound = port;
  if (getsockname(fd, (struct sockaddr *)&addr, &alen) == 0) bound = ntohs(addr.sin_port);
  snprintf(fsh_inspect_host, sizeof fsh_inspect_host, "%s", host);
  __atomic_store_n(&fsh_inspect_stopping, 0, __ATOMIC_RELEASE);
  fsh_inspect_fd = fd;
  if (pthread_create(&fsh_inspect_thread, NULL, fsh_inspector_loop, NULL) != 0) {
    close(fd);
    close(fsh_inspect_pipe[0]);
    close(fsh_inspect_pipe[1]);
    fsh_inspect_fd = fsh_inspect_pipe[0] = fsh_inspect_pipe[1] = -1;
    return;
  }
  fsh_inspect_running = 1;
  if ((ntohl(addr.sin_addr.s_addr) >> 24) != 127) {
    fprintf(stderr, "fish inspector: warning: binding non-loopback address %s:%d without authentication\n", host, bound);
  }
  fprintf(stderr, "fish inspector listening on http://%s:%d\n", host, bound);
  fflush(stderr);
}

static void fsh_inspector_stop(int detach) {
  if (!fsh_inspect_running) return;
  __atomic_store_n(&fsh_inspect_stopping, 1, __ATOMIC_RELEASE);
  char b = 1;
  ssize_t ignored = write(fsh_inspect_pipe[1], &b, 1);
  (void)ignored;
  if (detach) {
    pthread_detach(fsh_inspect_thread);
  } else {
    pthread_join(fsh_inspect_thread, NULL);
    close(fsh_inspect_fd);
    close(fsh_inspect_pipe[0]);
    close(fsh_inspect_pipe[1]);
    fsh_inspect_fd = fsh_inspect_pipe[0] = fsh_inspect_pipe[1] = -1;
  }
  fsh_inspect_running = 0;
}

#ifdef FSH_PROFILE
// Sampling profiler: a dedicated sampler thread sends SIGPROF to registered threads (main,
// async workers, and blocking pool threads). Each target's async-signal-safe handler walks its
// own fsh_rt_frames shadow stack into a lock-free ring buffer; the sampler drains the ring into
// an aggregated stack table and writes a folded-stack or interactive SVG flame graph on exit.
#define FSH_PROF_MAX_THREADS 1024
#define FSH_PROF_MAX_DEPTH 64
#define FSH_PROF_RING 4096

typedef struct {
  pthread_t tid;
  int32_t active;
} fsh_prof_slot;

typedef struct {
  int32_t depth;
  const char *names[FSH_PROF_MAX_DEPTH];
} fsh_prof_sample;

typedef struct {
  char *stack;
  uint64_t hash;
  uint64_t count;
} fsh_prof_entry;

static pthread_mutex_t fsh_prof_lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t fsh_prof_cond = PTHREAD_COND_INITIALIZER;
static fsh_prof_slot fsh_prof_slots[FSH_PROF_MAX_THREADS];
// Separate 16 KB state array so fsh_prof_drain avoids scanning 2+ MB of sample payloads per tick.
static int32_t fsh_prof_states[FSH_PROF_RING];
static fsh_prof_sample fsh_prof_ring[FSH_PROF_RING];
static uint64_t fsh_prof_write = 0;
static int32_t fsh_prof_enabled = 0;
static int32_t fsh_prof_stopping = 0;
static int32_t fsh_prof_in_flight = 0;
static int32_t fsh_prof_started = 0;
static int fsh_prof_main_slot = -1;
static int64_t fsh_prof_hz = 997;
static int64_t fsh_prof_threads_seen = 0;
static char fsh_prof_out[1024] = "fish-profile.svg";
static pthread_t fsh_prof_thread;
static fsh_prof_entry *fsh_prof_entries = NULL;
static size_t fsh_prof_cap = 0;
static size_t fsh_prof_count = 0;
static uint64_t fsh_prof_total = 0;

static int fsh_prof_is_active(void) {
  return __atomic_load_n(&fsh_prof_enabled, __ATOMIC_ACQUIRE) != 0;
}

static int fsh_prof_register(void) {
  if (!__atomic_load_n(&fsh_prof_started, __ATOMIC_ACQUIRE) && !__atomic_load_n(&fsh_prof_enabled, __ATOMIC_ACQUIRE)) {
    // Allow main thread registration during constructor before fsh_prof_started flips to 1.
    if (fsh_prof_main_slot != -2) return -1;
  }
  // Force macOS Mach-O lazy TLV allocation on this thread before SIGPROF can arrive here.
  (void)__atomic_load_n(&fsh_rt_frames, __ATOMIC_RELAXED);
  pthread_mutex_lock(&fsh_prof_lock);
  int found = -1;
  for (int i = 0; i < FSH_PROF_MAX_THREADS; i++) {
    if (!fsh_prof_slots[i].active) {
      fsh_prof_slots[i].tid = pthread_self();
      fsh_prof_slots[i].active = 1;
      __atomic_fetch_add(&fsh_prof_threads_seen, 1, __ATOMIC_RELAXED);
      found = i;
      break;
    }
  }
  pthread_mutex_unlock(&fsh_prof_lock);
  return found;
}

static void fsh_prof_unregister(int slot) {
  if (slot < 0 || slot >= FSH_PROF_MAX_THREADS) return;
  pthread_mutex_lock(&fsh_prof_lock);
  fsh_prof_slots[slot].active = 0;
  pthread_mutex_unlock(&fsh_prof_lock);
}

static void fsh_prof_handler(int sig) {
  (void)sig;
  int saved_errno = errno;
  __atomic_fetch_add(&fsh_prof_in_flight, 1, __ATOMIC_SEQ_CST);
  if (__atomic_load_n(&fsh_prof_enabled, __ATOMIC_SEQ_CST)) {
    fsh_frame *f = __atomic_load_n(&fsh_rt_frames, __ATOMIC_RELAXED);
    __atomic_signal_fence(__ATOMIC_ACQUIRE);
    if (f) {
      const char *tmp[FSH_PROF_MAX_DEPTH];
      int32_t depth = 0;
      while (f && depth < FSH_PROF_MAX_DEPTH) {
        tmp[depth++] = f->name ? f->name : "<unknown>";
        f = f->prev;
      }
      if (depth > 0) {
        uint64_t idx = __atomic_fetch_add(&fsh_prof_write, 1, __ATOMIC_RELAXED) & (FSH_PROF_RING - 1);
        int32_t expected = 0;
        if (__atomic_compare_exchange_n(&fsh_prof_states[idx], &expected, 1, 0, __ATOMIC_ACQUIRE, __ATOMIC_RELAXED)) {
          fsh_prof_ring[idx].depth = depth;
          for (int32_t i = 0; i < depth; i++) fsh_prof_ring[idx].names[i] = tmp[depth - 1 - i];
          __atomic_store_n(&fsh_prof_states[idx], 2, __ATOMIC_RELEASE);
        }
      }
    }
  }
  __atomic_fetch_sub(&fsh_prof_in_flight, 1, __ATOMIC_SEQ_CST);
  errno = saved_errno;
}

static uint64_t fsh_prof_hash(const char *s) {
  uint64_t h = 14695981039346656037ULL;
  for (const unsigned char *p = (const unsigned char *)s; *p; p++) {
    h ^= (uint64_t)*p;
    h *= 1099511628211ULL;
  }
  return h;
}

static void fsh_prof_table_grow(void) {
  size_t new_cap = fsh_prof_cap ? fsh_prof_cap * 2 : 256;
  fsh_prof_entry *next = calloc(new_cap, sizeof(fsh_prof_entry));
  if (!next) return;
  for (size_t i = 0; i < fsh_prof_cap; i++) {
    if (!fsh_prof_entries[i].stack) continue;
    size_t mask = new_cap - 1;
    size_t pos = (size_t)(fsh_prof_entries[i].hash & mask);
    while (next[pos].stack) pos = (pos + 1) & mask;
    next[pos] = fsh_prof_entries[i];
  }
  free(fsh_prof_entries);
  fsh_prof_entries = next;
  fsh_prof_cap = new_cap;
}

static void fsh_prof_record(const char *const *names, int32_t depth) {
  size_t len = 0;
  for (int32_t i = 0; i < depth; i++) len += strlen(names[i]) + (i > 0 ? 1 : 0);
  char *stack = malloc(len + 1);
  if (!stack) return;
  char *w = stack;
  for (int32_t i = 0; i < depth; i++) {
    if (i > 0) *w++ = ';';
    size_t n = strlen(names[i]);
    memcpy(w, names[i], n);
    w += n;
  }
  *w = 0;
  uint64_t h = fsh_prof_hash(stack);
  if (fsh_prof_count * 2 >= fsh_prof_cap) fsh_prof_table_grow();
  if (!fsh_prof_entries || fsh_prof_cap == 0) { free(stack); return; }
  size_t mask = fsh_prof_cap - 1;
  size_t pos = (size_t)(h & mask);
  size_t checked = 0;
  while (fsh_prof_entries[pos].stack) {
    if (fsh_prof_entries[pos].hash == h && strcmp(fsh_prof_entries[pos].stack, stack) == 0) {
      fsh_prof_entries[pos].count++;
      fsh_prof_total++;
      free(stack);
      return;
    }
    if (++checked >= fsh_prof_cap) { free(stack); return; }
    pos = (pos + 1) & mask;
  }
  if (fsh_prof_count + 1 >= fsh_prof_cap) { free(stack); return; }
  fsh_prof_entries[pos].stack = stack;
  fsh_prof_entries[pos].hash = h;
  fsh_prof_entries[pos].count = 1;
  fsh_prof_count++;
  fsh_prof_total++;
}

static void fsh_prof_drain(void) {
  for (size_t i = 0; i < FSH_PROF_RING; i++) {
    if (__atomic_load_n(&fsh_prof_states[i], __ATOMIC_ACQUIRE) == 2) {
      int32_t d = fsh_prof_ring[i].depth;
      const char *names[FSH_PROF_MAX_DEPTH];
      if (d > FSH_PROF_MAX_DEPTH) d = FSH_PROF_MAX_DEPTH;
      for (int32_t k = 0; k < d; k++) names[k] = fsh_prof_ring[i].names[k];
      __atomic_store_n(&fsh_prof_states[i], 0, __ATOMIC_RELEASE);
      if (d > 0) fsh_prof_record(names, d);
    }
  }
}

static void *fsh_prof_sampler(void *arg) {
  (void)arg;
  sigset_t mask;
  sigemptyset(&mask);
  sigaddset(&mask, SIGPROF);
  pthread_sigmask(SIG_BLOCK, &mask, NULL);
  int64_t step_ns = 1000000000LL / fsh_prof_hz;
  if (step_ns < 100000LL) step_ns = 100000LL;
  for (;;) {
    pthread_mutex_lock(&fsh_prof_lock);
    if (fsh_prof_stopping) {
      pthread_mutex_unlock(&fsh_prof_lock);
      break;
    }
    struct timespec until;
    clock_gettime(CLOCK_REALTIME, &until);
    until.tv_nsec += (long)step_ns;
    until.tv_sec += until.tv_nsec / 1000000000L;
    until.tv_nsec %= 1000000000L;
    pthread_cond_timedwait(&fsh_prof_cond, &fsh_prof_lock, &until);
    if (fsh_prof_stopping) {
      pthread_mutex_unlock(&fsh_prof_lock);
      break;
    }
    // Hold fsh_prof_lock while sending SIGPROF so no registered thread can unregister and exit
    // before pthread_kill runs; the handler never acquires fsh_prof_lock.
    for (int i = 0; i < FSH_PROF_MAX_THREADS; i++) {
      if (fsh_prof_slots[i].active) pthread_kill(fsh_prof_slots[i].tid, SIGPROF);
    }
    pthread_mutex_unlock(&fsh_prof_lock);
    fsh_prof_drain();
  }
  return NULL;
}

// Orders '\0' < ';' < all other bytes so children ("foo;bar") always sort immediately after their
// parent ("foo") rather than being split by sibling names like "foo2" or "foo.bar".
static int fsh_prof_entry_cmp(const void *a, const void *b) {
  const unsigned char *p = (const unsigned char *)((const fsh_prof_entry *)a)->stack;
  const unsigned char *q = (const unsigned char *)((const fsh_prof_entry *)b)->stack;
  while (*p && *p == *q) { p++; q++; }
  int ca = *p == 0 ? 0 : *p == ';' ? 1 : (int)*p + 2;
  int cb = *q == 0 ? 0 : *q == ';' ? 1 : (int)*q + 2;
  return ca < cb ? -1 : ca > cb ? 1 : 0;
}

static void fsh_buf_xml(fsh_buf *b, const char *s) {
  if (!s) return;
  for (const char *p = s; *p; p++) {
    if (*p == '&') fsh_buf_puts(b, "&amp;");
    else if (*p == '<') fsh_buf_puts(b, "&lt;");
    else if (*p == '>') fsh_buf_puts(b, "&gt;");
    else if (*p == '"') fsh_buf_puts(b, "&quot;");
    else if (*p == '\'') fsh_buf_puts(b, "&apos;");
    else fsh_buf_putn(b, p, 1);
  }
}

typedef struct {
  int32_t depth;
  uint64_t x_start;
  uint64_t samples;
  char *name;
} fsh_fg_rect;

typedef struct {
  char *name;
  uint64_t x_start;
  uint64_t samples;
} fsh_fg_open;

static void fsh_fg_push_rect(fsh_fg_rect **rects, size_t *count, size_t *cap, int32_t depth, uint64_t x_start, uint64_t samples, const char *name) {
  if (!name) return;
  if (*count == *cap) {
    size_t ncap = *cap ? *cap * 2 : 128;
    fsh_fg_rect *next = realloc(*rects, ncap * sizeof(fsh_fg_rect));
    if (!next) return;
    *rects = next;
    *cap = ncap;
  }
  char *copy = strdup(name);
  if (!copy) return;
  (*rects)[(*count)++] = (fsh_fg_rect){ depth, x_start, samples, copy };
}

static int fsh_prof_write_svg(FILE *fp, const fsh_prof_entry *sorted, size_t n, uint64_t total) {
  fsh_fg_rect *rects = NULL;
  size_t rcount = 0, rcap = 0;
  fsh_fg_open open[FSH_PROF_MAX_DEPTH];
  int32_t open_depth = 0;
  int32_t max_depth = 0;
  uint64_t cursor = 0;

  if (total > 0) {
    fsh_fg_push_rect(&rects, &rcount, &rcap, 0, 0, total, "all");
  }
  for (size_t i = 0; i < n; i++) {
    const char *parts[FSH_PROF_MAX_DEPTH];
    size_t plen[FSH_PROF_MAX_DEPTH];
    int32_t depth = 0;
    const char *p = sorted[i].stack;
    while (*p && depth < FSH_PROF_MAX_DEPTH) {
      const char *semi = strchr(p, ';');
      parts[depth] = p;
      plen[depth] = semi ? (size_t)(semi - p) : strlen(p);
      depth++;
      if (!semi) break;
      p = semi + 1;
    }
    if (depth > max_depth) max_depth = depth;
    int32_t common = 0;
    while (common < open_depth && common < depth &&
           strlen(open[common].name) == plen[common] &&
           memcmp(open[common].name, parts[common], plen[common]) == 0) {
      common++;
    }
    for (int32_t d = open_depth - 1; d >= common; d--) {
      fsh_fg_push_rect(&rects, &rcount, &rcap, d + 1, open[d].x_start, open[d].samples, open[d].name);
      free(open[d].name);
    }
    for (int32_t d = 0; d < common; d++) open[d].samples += sorted[i].count;
    int32_t opened = common;
    for (int32_t d = common; d < depth; d++) {
      char *copy = malloc(plen[d] + 1);
      if (!copy) break;
      memcpy(copy, parts[d], plen[d]);
      copy[plen[d]] = 0;
      open[d] = (fsh_fg_open){ copy, cursor, sorted[i].count };
      opened = d + 1;
    }
    open_depth = opened;
    cursor += sorted[i].count;
  }
  for (int32_t d = open_depth - 1; d >= 0; d--) {
    fsh_fg_push_rect(&rects, &rcount, &rcap, d + 1, open[d].x_start, open[d].samples, open[d].name);
    free(open[d].name);
  }

  int width = 1200;
  int pad = 10;
  int frame_h = 18;
  int header_h = 46;
  int footer_h = 26;
  int inner_w = width - pad * 2;
  int height = header_h + footer_h + (max_depth + 2) * frame_h;
  int base_y = height - footer_h;

  fsh_buf b = { NULL, 0, 0, 0 };
  fsh_buf_printf(&b,
    "<?xml version=\"1.0\" standalone=\"no\"?>\n"
    "<svg version=\"1.1\" width=\"%d\" height=\"%d\" viewBox=\"0 0 %d %d\" xmlns=\"http://www.w3.org/2000/svg\">\n"
    "<style>"
    "text{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;fill:#111}"
    ".fg{cursor:pointer}.fg:hover rect{stroke:#111;stroke-width:0.8}"
    "</style>\n"
    "<rect width=\"100%%\" height=\"100%%\" fill=\"#f8f8f5\"/>\n"
    "<text x=\"%d\" y=\"24\" style=\"font-size:16px;font-weight:bold\">Fish Flame Graph (%llu sample%s)</text>\n"
    "<text id=\"reset\" x=\"%d\" y=\"24\" text-anchor=\"end\" style=\"cursor:pointer;fill:#444;display:none\">Reset Zoom</text>\n",
    width, height, width, height, pad, (unsigned long long)total, total == 1 ? "" : "s", width - pad);

  if (total == 0) {
    fsh_buf_printf(&b, "<text x=\"%d\" y=\"%d\">No stack samples collected.</text>\n", pad, header_h + 18);
  } else {
    for (size_t i = 0; i < rcount; i++) {
      double x = pad + ((double)rects[i].x_start / (double)total) * inner_w;
      double w = ((double)rects[i].samples / (double)total) * inner_w;
      if (w < 0.1) continue;
      int y = base_y - (rects[i].depth + 1) * frame_h;
      double pct = 100.0 * (double)rects[i].samples / (double)total;
      uint64_t h = fsh_prof_hash(rects[i].name);
      int cr = rects[i].depth == 0 ? 225 : (int)(205 + (h % 50));
      int cg = rects[i].depth == 0 ? 190 : (int)(85 + ((h >> 8) % 125));
      int cb = rects[i].depth == 0 ? 140 : (int)(25 + ((h >> 16) % 55));
      fsh_buf_printf(&b, "<g class=\"fg\" data-x=\"%.6f\" data-w=\"%.6f\" data-d=\"%d\"><title>",
        (double)rects[i].x_start / (double)total, (double)rects[i].samples / (double)total, rects[i].depth);
      fsh_buf_xml(&b, rects[i].name);
      fsh_buf_printf(&b, " (%llu sample%s, %.2f%%)</title>", (unsigned long long)rects[i].samples, rects[i].samples == 1 ? "" : "s", pct);
      fsh_buf_printf(&b, "<rect x=\"%.2f\" y=\"%d\" width=\"%.2f\" height=\"%d\" rx=\"2\" fill=\"rgb(%d,%d,%d)\"/>",
        x, y, w > 1.0 ? w - 0.5 : w, frame_h - 1, cr, cg, cb);
      int max_chars = (int)((w - 6.0) / 7.2);
      fsh_buf_printf(&b, "<text x=\"%.2f\" y=\"%d\">", x + 3.0, y + 13);
      if (max_chars >= 3) {
        size_t nlen = strlen(rects[i].name);
        if ((int)nlen <= max_chars) {
          fsh_buf_xml(&b, rects[i].name);
        } else {
          char cut[128];
          int keep = max_chars - 2;
          if (keep > (int)sizeof cut - 4) keep = (int)sizeof cut - 4;
          if (keep < 1) keep = 1;
          while (keep > 0 && ((unsigned char)rects[i].name[keep] & 0xC0) == 0x80) keep--;
          memcpy(cut, rects[i].name, (size_t)keep);
          cut[keep] = '.';
          cut[keep + 1] = '.';
          cut[keep + 2] = 0;
          fsh_buf_xml(&b, cut);
        }
      }
      fsh_buf_puts(&b, "</text></g>\n");
    }
  }

  fsh_buf_printf(&b,
    "<script><![CDATA[\n"
    "(function(){\n"
    "var pad=%d,iw=%d,gs=document.getElementsByClassName('fg'),rst=document.getElementById('reset');\n"
    "function zoom(zx,zw){\n"
    "  rst.style.display=(zx>0||zw<1)?'block':'none';\n"
    "  for(var i=0;i<gs.length;i++){\n"
    "    var g=gs[i],x=parseFloat(g.getAttribute('data-x')),w=parseFloat(g.getAttribute('data-w'));\n"
    "    var x0=Math.max(x,zx),x1=Math.min(x+w,zx+zw);\n"
    "    if(x1<=x0){g.style.display='none';continue;}\n"
    "    g.style.display='';\n"
    "    var px=pad+((x0-zx)/zw)*iw,pw=((x1-x0)/zw)*iw;\n"
    "    var r=g.getElementsByTagName('rect')[0],t=g.getElementsByTagName('text')[0];\n"
    "    r.setAttribute('x',px.toFixed(2));r.setAttribute('width',Math.max(0.5,pw-0.5).toFixed(2));\n"
    "    t.setAttribute('x',(px+3).toFixed(2));\n"
    "  }\n"
    "}\n"
    "for(var i=0;i<gs.length;i++){gs[i].addEventListener('click',function(){zoom(parseFloat(this.getAttribute('data-x')),parseFloat(this.getAttribute('data-w')));});}\n"
    "rst.addEventListener('click',function(){zoom(0,1);});\n"
    "})();\n"
    "]]></script>\n</svg>\n", pad, inner_w);

  int ok = !b.failed && b.data != NULL && fwrite(b.data, 1, b.len, fp) == b.len;
  free(b.data);
  for (size_t i = 0; i < rcount; i++) free(rects[i].name);
  free(rects);
  return ok;
}

static int fsh_prof_is_folded(const char *path) {
  size_t len = strlen(path);
  return (len >= 7 && strcmp(path + len - 7, ".folded") == 0) ||
         (len >= 4 && strcmp(path + len - 4, ".txt") == 0);
}

__attribute__((constructor)) static void fsh_prof_init(void) {
  const char *out = getenv("FISH_PROFILE");
  if (out && (strcmp(out, "0") == 0 || strcmp(out, "off") == 0 || strcmp(out, "false") == 0)) return;
  if (out && out[0] && strcmp(out, "1") != 0 && strcmp(out, "true") != 0) {
    int n = snprintf(fsh_prof_out, sizeof fsh_prof_out, "%s", out);
    if (n < 0 || (size_t)n >= sizeof fsh_prof_out) {
      fprintf(stderr, "fish profile: FISH_PROFILE path is too long (max %zu bytes)\n", sizeof fsh_prof_out - 1);
      return;
    }
  }
  const char *hz_env = getenv("FISH_PROFILE_HZ");
  if (hz_env && hz_env[0]) {
    char *end = NULL;
    long v = strtol(hz_env, &end, 10);
    if (end && *end == '\0' && v >= 10 && v <= 10000) fsh_prof_hz = v;
  }
  fsh_prof_main_slot = -2;
  fsh_prof_main_slot = fsh_prof_register();
  struct sigaction sa;
  memset(&sa, 0, sizeof sa);
  sa.sa_handler = fsh_prof_handler;
  sigemptyset(&sa.sa_mask);
  sa.sa_flags = SA_RESTART;
  if (sigaction(SIGPROF, &sa, NULL) != 0) {
    fsh_prof_unregister(fsh_prof_main_slot);
    fsh_prof_main_slot = -1;
    return;
  }
  __atomic_store_n(&fsh_prof_enabled, 1, __ATOMIC_SEQ_CST);
  if (pthread_create(&fsh_prof_thread, NULL, fsh_prof_sampler, NULL) != 0) {
    __atomic_store_n(&fsh_prof_enabled, 0, __ATOMIC_SEQ_CST);
    fsh_prof_unregister(fsh_prof_main_slot);
    fsh_prof_main_slot = -1;
    return;
  }
  __atomic_store_n(&fsh_prof_started, 1, __ATOMIC_RELEASE);
}

__attribute__((destructor)) static void fsh_prof_fini(void) {
  if (!__atomic_load_n(&fsh_prof_started, __ATOMIC_ACQUIRE)) return;
  __atomic_store_n(&fsh_prof_started, 0, __ATOMIC_RELEASE);
  pthread_mutex_lock(&fsh_prof_lock);
  fsh_prof_stopping = 1;
  pthread_cond_broadcast(&fsh_prof_cond);
  pthread_mutex_unlock(&fsh_prof_lock);
  pthread_join(fsh_prof_thread, NULL);
  __atomic_store_n(&fsh_prof_enabled, 0, __ATOMIC_SEQ_CST);
  for (int i = 0; i < 500 && __atomic_load_n(&fsh_prof_in_flight, __ATOMIC_SEQ_CST) > 0; i++) {
    struct timespec ts = { 0, 100000 };
    nanosleep(&ts, NULL);
  }
  signal(SIGPROF, SIG_IGN);
  fsh_prof_unregister(fsh_prof_main_slot);
  fsh_prof_drain();

  fsh_prof_entry *sorted = fsh_prof_count > 0 ? malloc(fsh_prof_count * sizeof(fsh_prof_entry)) : NULL;
  size_t n = 0;
  if (sorted) {
    for (size_t i = 0; i < fsh_prof_cap; i++) {
      if (fsh_prof_entries[i].stack) sorted[n++] = fsh_prof_entries[i];
    }
    if (n > 1) qsort(sorted, n, sizeof(fsh_prof_entry), fsh_prof_entry_cmp);
  }

  FILE *fp = fopen(fsh_prof_out, "wb");
  if (!fp) {
    fprintf(stderr, "fish profile: failed to write '%s' (%s)\n", fsh_prof_out, strerror(errno));
  } else {
    int ok = 1;
    if (fsh_prof_is_folded(fsh_prof_out)) {
      for (size_t i = 0; i < n; i++) {
        if (fprintf(fp, "%s %llu\n", sorted[i].stack, (unsigned long long)sorted[i].count) < 0) { ok = 0; break; }
      }
    } else {
      ok = fsh_prof_write_svg(fp, sorted, n, fsh_prof_total);
    }
    if (ferror(fp)) ok = 0;
    if (fclose(fp) != 0) ok = 0;
    if (!ok) {
      fprintf(stderr, "fish profile: failed to write '%s'\n", fsh_prof_out);
    } else {
      int64_t threads = __atomic_load_n(&fsh_prof_threads_seen, __ATOMIC_RELAXED);
      fprintf(stderr, "fish profile: %llu samples across %lld thread%s written to %s\n",
        (unsigned long long)fsh_prof_total, (long long)threads, threads == 1 ? "" : "s", fsh_prof_out);
    }
  }

  free(sorted);
  for (size_t i = 0; i < fsh_prof_cap; i++) free(fsh_prof_entries[i].stack);
  free(fsh_prof_entries);
  fsh_prof_entries = NULL;
  fsh_prof_cap = fsh_prof_count = 0;
}
#endif

// Single-threaded deterministic simulation executor: no worker, timer, reactor, or pool threads.
static int32_t fsh_sim_run(fsh_poll_fn poll, fsh_drop_fn drop, fsh_drop_fn drop_output, void *frame, int64_t frame_size, int64_t output_size, void *out, const char *name, const char *site) {
  fsh_sim_stopping = 0;
  fsh_main_task = fsh_rt_spawn(poll, drop, drop_output, frame, frame_size, output_size, name, site);
  for (int phase = 0; phase < 2; phase++) {
    if (phase == 1) {
      if (fsh_panicked || fsh_main_task->outcome == 2) break;
      fsh_timeouts_main_returned();
    }
    for (;;) {
      if (fsh_panicked) break;
      if (phase == 0 && __atomic_load_n(&fsh_main_task->state, __ATOMIC_ACQUIRE) == FSH_DONE) break;
      if (phase == 1) {
        int32_t claimed = __atomic_load_n(&fsh_timeouts_claimed, __ATOMIC_ACQUIRE);
        if (fsh_timeouts_task ? __atomic_load_n(&fsh_timeouts_task->state, __ATOMIC_ACQUIRE) == FSH_DONE : !claimed) break;
      }
      fsh_sim_fire_due();
      if (fsh_sim_ready_count > 0) {
        int64_t idx = (int64_t)(fsh_sim_next_u64(fsh_sim_sched_rng) % (uint64_t)fsh_sim_ready_count);
        fsh_task *t = fsh_sim_ready[idx];
        fsh_sim_ready[idx] = fsh_sim_ready[--fsh_sim_ready_count];
        fsh_run(t);
        continue;
      }
      int64_t next_ns = 0;
      if (fsh_sim_next_event_ns(&next_ns)) {
        if (next_ns > fsh_sim_now_ns) fsh_sim_now_ns = next_ns;
        fsh_sim_fire_due();
        continue;
      }
      if (phase == 0 && __atomic_load_n(&fsh_main_task->state, __ATOMIC_ACQUIRE) == FSH_DONE) break;
      if (phase == 1) {
        int32_t claimed = __atomic_load_n(&fsh_timeouts_claimed, __ATOMIC_ACQUIRE);
        if (fsh_timeouts_task ? __atomic_load_n(&fsh_timeouts_task->state, __ATOMIC_ACQUIRE) == FSH_DONE : !claimed) break;
      }
      fprintf(stderr, "fish sim deadlock (seed %llu) at %lldms: no runnable tasks, timers, or network events\n",
        (unsigned long long)fsh_sim_seed_val, (long long)(fsh_sim_now_ns / 1000000));
      for (fsh_task *a = fsh_alive; a; a = a->next) {
        const char *aw = a->awaiting ? a->awaiting : "idle";
        fprintf(stderr, "  task #%lld (%s): awaiting %s\n", (long long)a->id, a->name && a->name[0] ? a->name : "<anonymous>", aw);
      }
      fflush(stderr);
      fsh_abandoned = 1;
      exit(101);
    }
  }
  fsh_sim_stopping = 1;
  fsh_sim_drain_events();
  while (fsh_timer_count > 0) fsh_timer_fire(fsh_timer_take(), 0);
  free(fsh_timers);
  fsh_timers = NULL;
  fsh_timer_capacity = 0;
  for (;;) {
    fsh_task *t = fsh_alive;
    if (!t) break;
    fsh_unlink(t);
    __atomic_store_n(&t->state, FSH_DONE, __ATOMIC_RELEASE);
    t->drop(t->memory);
    if (t->joiner) fsh_task_release(t->joiner);
    t->joiner = NULL;
    fsh_task_release(t);
  }
  while (fsh_timeout_count > 0) {
    fsh_timeout t = fsh_timeout_take(0);
    ((void (*)(void *))t.vtable[0])(t.block);
  }
  free(fsh_timeouts);
  fsh_timeouts = NULL;
  fsh_timeout_capacity = 0;
  if (fsh_timeouts_waiter) fsh_task_release(fsh_timeouts_waiter);
  if (fsh_timeouts_task) fsh_task_release(fsh_timeouts_task);
  fsh_timeouts_waiter = fsh_timeouts_task = NULL;
  fsh_sim_free_globals();
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

// Runs an async main: starts the workers, runs main as the first task until it is done or a
// task panics, stops them, drops every task still alive, and gives main's outcome, its poll
// result copied to out.
int32_t fsh_rt_run(fsh_poll_fn poll, fsh_drop_fn drop, fsh_drop_fn drop_output, void *frame, int64_t frame_size, int64_t output_size, void *out, const char *name, const char *site) {
  fsh_sim_init();
  if (fsh_sim_active) return fsh_sim_run(poll, drop, drop_output, frame, frame_size, output_size, out, name, site);
  long cores = sysconf(_SC_NPROCESSORS_ONLN);
  fsh_workers = cores > 0 ? cores : 1;
  fsh_queues = calloc(fsh_workers, sizeof(fsh_queue));
  fsh_threads = calloc(fsh_workers, sizeof(pthread_t));
  for (int64_t i = 0; i < fsh_workers; i++) pthread_mutex_init(&fsh_queues[i].lock, NULL);
  fsh_main_task = fsh_rt_spawn(poll, drop, drop_output, frame, frame_size, output_size, name, site);
  // The reactor is ready before any task can wait on a socket.
  fsh_io_start();
  fsh_inspector_start();
  // Workers get 64 MiB stacks, since main's calls run on them: deep recursion, as a compiler's
  // over a program's tree, goes as far as it does under a JavaScript engine. Only the pages a
  // thread touches are ever committed.
  pthread_attr_t attr;
  pthread_attr_init(&attr);
  pthread_attr_setstacksize(&attr, 64 << 20);
  for (int64_t i = 0; i < fsh_workers; i++) pthread_create(&fsh_threads[i], &attr, fsh_work, (void *)i);
  pthread_attr_destroy(&attr);
  pthread_create(&fsh_timer_thread, NULL, fsh_timing, NULL);
  pthread_mutex_lock(&fsh_alive_lock);
  while (__atomic_load_n(&fsh_main_task->state, __ATOMIC_ACQUIRE) != FSH_DONE && !fsh_panicked) pthread_cond_wait(&fsh_finished, &fsh_alive_lock);
  pthread_mutex_unlock(&fsh_alive_lock);
  // Pending timers keep the program alive: the timer task runs them, then ends. A
  // main that failed ends the program with its error, its timers dropped with the other tasks;
  // a timer task claimed but not yet registered is waited for.
  if (fsh_main_task->outcome != 2) {
    fsh_timeouts_main_returned();
    pthread_mutex_lock(&fsh_alive_lock);
    while (!fsh_panicked) {
      int32_t claimed = __atomic_load_n(&fsh_timeouts_claimed, __ATOMIC_ACQUIRE);
      if (fsh_timeouts_task ? __atomic_load_n(&fsh_timeouts_task->state, __ATOMIC_ACQUIRE) == FSH_DONE : !claimed) break;
      pthread_cond_wait(&fsh_finished, &fsh_alive_lock);
    }
    pthread_mutex_unlock(&fsh_alive_lock);
  }
  pthread_mutex_lock(&fsh_park);
  __atomic_store_n(&fsh_stopping, 1, __ATOMIC_SEQ_CST);
  pthread_cond_broadcast(&fsh_parked);
  // A worker stops between polls, so one inside a long poll with no await can't be waited for:
  // past a grace period, its task and every other is abandoned rather than dropped.
  struct timespec until;
  clock_gettime(CLOCK_REALTIME, &until);
  until.tv_nsec += 100000000;
  until.tv_sec += until.tv_nsec / 1000000000;
  until.tv_nsec %= 1000000000;
  while ((fsh_stopped < fsh_workers || __atomic_load_n(&fsh_pool_busy, __ATOMIC_SEQ_CST) != 0 || __atomic_load_n(&fsh_shutdown_busy, __ATOMIC_SEQ_CST) != 0) && pthread_cond_timedwait(&fsh_left, &fsh_park, &until) == 0) {}
  // A blocking task or pool job still active (or a shutdown signal still aborting) can't be dropped
  // while its thread may still touch runtime state.
  int stuck = fsh_stopped < fsh_workers || __atomic_load_n(&fsh_blocking_live, __ATOMIC_ACQUIRE) != 0 || __atomic_load_n(&fsh_pool_busy, __ATOMIC_SEQ_CST) != 0 || __atomic_load_n(&fsh_shutdown_busy, __ATOMIC_SEQ_CST) != 0;
  pthread_mutex_unlock(&fsh_park);
  if (stuck) {
    fsh_abandoned = 1;
    // Detached, the abandoned threads end with the process rather than as leaks a thread
    // sanitizer reports.
    for (int64_t i = 0; i < fsh_workers; i++) pthread_detach(fsh_threads[i]);
    pthread_detach(fsh_timer_thread);
    pthread_detach(fsh_io_thread);
    fsh_inspector_stop(1);
    if (fsh_panicked) exit(101);
    memcpy(out, fsh_output(fsh_main_task), output_size);
    return fsh_main_task->outcome;
  }
  for (int64_t i = 0; i < fsh_workers; i++) pthread_join(fsh_threads[i], NULL);
  // A pool thread is never joined, so one still freeing a task it finished is waited for here.
  while (__atomic_load_n(&fsh_blocking_ending, __ATOMIC_ACQUIRE) != 0) sched_yield();
  pthread_mutex_lock(&fsh_timer_lock);
  fsh_timers_stopping = 1;
  pthread_cond_signal(&fsh_timer_changed);
  pthread_mutex_unlock(&fsh_timer_lock);
  pthread_join(fsh_timer_thread, NULL);
  fsh_io_stop();
  fsh_inspector_stop(0);
  while (fsh_timer_count > 0) fsh_timer_fire(fsh_timer_take(), 0);
  free(fsh_timers);
  if (fsh_shutdown_end) {
    fsh_shutdown_end();
    fsh_shutdown_end = NULL;
  }
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
  // Timers left, set after the timer task ended or left by a failed main, are dropped.
  while (fsh_timeout_count > 0) {
    fsh_timeout t = fsh_timeout_take(0);
    ((void (*)(void *))t.vtable[0])(t.block);
  }
  free(fsh_timeouts);
  fsh_timeouts = NULL;
  fsh_timeout_capacity = 0;
  if (fsh_timeouts_waiter) fsh_task_release(fsh_timeouts_waiter);
  if (fsh_timeouts_task) fsh_task_release(fsh_timeouts_task);
  fsh_timeouts_waiter = fsh_timeouts_task = NULL;
  for (int64_t i = 0; i < fsh_workers; i++) free(fsh_queues[i].ring);
  pthread_mutex_lock(&fsh_injected.lock);
  free(fsh_injected.ring);
  fsh_injected.ring = NULL;
  fsh_injected.head = fsh_injected.count = fsh_injected.capacity = 0;
  pthread_mutex_unlock(&fsh_injected.lock);
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

// Regexes: programs compiled while compiling (src/regex.fsh), run over a string's UTF-16 code
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

// The TLS half of the runtime, over OpenSSL, compiled into a program only when its IR calls
// `fsh_rt_tls_`, after the rest of the runtime, whose socket calls reach it through a socket's
// `tls_ops`. A TLS stream is a TcpStream whose reads and writes go through its SSL object.
export const TLS_NATIVE = String.raw`
#include <openssl/ssl.h>
#include <openssl/err.h>
#include <openssl/pem.h>
#include <openssl/x509v3.h>
#include <openssl/evp.h>
#include <openssl/hmac.h>

// A stream's SSL object, or a listener's context its connections are made from. A clone of a
// stream may read on one thread while another writes, and OpenSSL's calls on one SSL object
// mustn't overlap, so each call holds the lock; none holds it while waiting.
typedef struct { SSL_CTX *ctx; SSL *ssl; pthread_mutex_t lock; } fsh_tls;

// OpenSSL writes to the socket itself, without the MSG_NOSIGNAL Linux needs to keep a closed
// peer from ending the program with SIGPIPE, so the signal is held back on this thread while it
// works, and one that came is taken. macOS sockets are made with SO_NOSIGPIPE.
#ifdef __APPLE__
#define FSH_TLS_QUIET(before) (void)(before)
#define FSH_TLS_LOUD(before) (void)(before)
#else
#define FSH_TLS_QUIET(before) fsh_tls_quiet(&(before))
#define FSH_TLS_LOUD(before) fsh_tls_loud(&(before))
static void fsh_tls_quiet(sigset_t *before) {
  sigset_t pipe_only;
  sigemptyset(&pipe_only);
  sigaddset(&pipe_only, SIGPIPE);
  pthread_sigmask(SIG_BLOCK, &pipe_only, before);
}
static void fsh_tls_loud(sigset_t *before) {
  sigset_t pending, pipe_only;
  sigemptyset(&pipe_only);
  sigaddset(&pipe_only, SIGPIPE);
  sigpending(&pending);
  if (sigismember(&pending, SIGPIPE) && !sigismember(before, SIGPIPE)) {
    int taken;
    sigwait(&pipe_only, &taken);
  }
  pthread_sigmask(SIG_SETMASK, before, NULL);
}
#endif

// The error codes for the certificate failures a client meets most.
static const char *fsh_tls_code(long verify) {
  switch (verify) {
    case X509_V_ERR_HOSTNAME_MISMATCH:
    case X509_V_ERR_IP_ADDRESS_MISMATCH: return "ERR_TLS_CERT_ALTNAME_INVALID";
    case X509_V_ERR_UNABLE_TO_GET_ISSUER_CERT_LOCALLY: return "UNABLE_TO_GET_ISSUER_CERT_LOCALLY";
    case X509_V_ERR_UNABLE_TO_VERIFY_LEAF_SIGNATURE: return "UNABLE_TO_VERIFY_LEAF_SIGNATURE";
    case X509_V_ERR_DEPTH_ZERO_SELF_SIGNED_CERT: return "DEPTH_ZERO_SELF_SIGNED_CERT";
    case X509_V_ERR_SELF_SIGNED_CERT_IN_CHAIN: return "SELF_SIGNED_CERT_IN_CHAIN";
    case X509_V_ERR_CERT_HAS_EXPIRED: return "CERT_HAS_EXPIRED";
    case X509_V_ERR_CERT_NOT_YET_VALID: return "CERT_NOT_YET_VALID";
    default: return "EPROTO";
  }
}

// What a failed SSL call means, with the lock held: 0 to wait, the way to wait in *writing; 1 for
// the end of the stream, when reading; or 5 with the reason. number is errno from the call.
static int32_t fsh_tls_failed(fsh_tls *t, int ret, int number, int reading, const char *syscall, int32_t *writing, fsh_str **message) {
  int error = SSL_get_error(t->ssl, ret);
  if (error == SSL_ERROR_WANT_READ || error == SSL_ERROR_WANT_WRITE) {
    *writing = error == SSL_ERROR_WANT_WRITE;
    return 0;
  }
  int handshake = !SSL_is_init_finished(t->ssl);
  if (error == SSL_ERROR_ZERO_RETURN && reading) return 1;
  long verify = SSL_get_verify_result(t->ssl);
  char text[320];
  int32_t failed;
  if (verify != X509_V_OK) {
    snprintf(text, sizeof text, "certificate verify failed: %s", X509_verify_cert_error_string(verify));
    failed = fsh_io_parts(message, text, fsh_tls_code(verify), syscall, NULL);
  } else if (error == SSL_ERROR_SYSCALL && number != 0) {
    errno = number;
    failed = fsh_io_failed(message, reading ? "can't read" : "can't write", syscall);
  } else if (error == SSL_ERROR_SYSCALL || error == SSL_ERROR_ZERO_RETURN) {
    failed = fsh_io_parts(message, handshake ? "the connection closed during the TLS handshake" : "the peer closed the TLS connection", "ECONNRESET", syscall, NULL);
  } else {
    const char *why = ERR_reason_error_string(ERR_peek_last_error());
    snprintf(text, sizeof text, "%s: %s", handshake ? "the TLS handshake failed" : "TLS failed", why ? why : "unknown error");
    failed = fsh_io_parts(message, text, "EPROTO", syscall, NULL);
  }
  ERR_clear_error();
  return failed;
}

static int32_t fsh_tls_read(fsh_socket *s, int64_t max, fsh_task *task, fsh_array *out, fsh_str **message) {
  fsh_tls *t = s->tls;
  char buffer[65536];
  size_t n = 0;
  int32_t writing = 0, done = 2;
  sigset_t before;
  pthread_mutex_lock(&t->lock);
  FSH_TLS_QUIET(before);
  ERR_clear_error();
  errno = 0;
  int ok = SSL_read_ex(t->ssl, buffer, (size_t)(max < (int64_t)sizeof buffer ? max : (int64_t)sizeof buffer), &n);
  if (!ok) done = fsh_tls_failed(t, ok, errno, 1, "read", &writing, message);
  FSH_TLS_LOUD(before);
  pthread_mutex_unlock(&t->lock);
  if (done == 2) {
    char *data = fsh_rt_alloc(n);
    memcpy(data, buffer, n);
    *out = (fsh_array){data, (int64_t)n, (int64_t)n};
    return 1;
  }
  if (done == 1) *out = (fsh_array){NULL, 0, 0};
  if (done == 0) fsh_io_wait(s->fd, writing, task);
  return done;
}

// Sends what is left past *written, finishing the handshake first, so writing nothing finishes
// it alone. A retried SSL_write_ex is given the same bytes, as OpenSSL requires.
static int32_t fsh_tls_write(fsh_socket *s, fsh_array *bytes, int64_t *written, fsh_task *task, fsh_str **message) {
  fsh_tls *t = s->tls;
  int32_t writing = 0, done = 1;
  sigset_t before;
  pthread_mutex_lock(&t->lock);
  FSH_TLS_QUIET(before);
  ERR_clear_error();
  errno = 0;
  if (!SSL_is_init_finished(t->ssl)) {
    int ok = SSL_do_handshake(t->ssl);
    if (ok != 1) done = fsh_tls_failed(t, ok, errno, 0, "write", &writing, message);
  }
  while (done == 1 && *written < bytes->length) {
    size_t n = 0;
    errno = 0;
    int ok = SSL_write_ex(t->ssl, bytes->data + *written, (size_t)(bytes->length - *written), &n);
    if (ok) *written += (int64_t)n;
    else done = fsh_tls_failed(t, ok, errno, 0, "write", &writing, message);
  }
  FSH_TLS_LOUD(before);
  pthread_mutex_unlock(&t->lock);
  if (done == 0) fsh_io_wait(s->fd, writing, task);
  return done;
}

static fsh_tls *fsh_tls_new(SSL_CTX *ctx, SSL *ssl) {
  fsh_tls *t = fsh_rt_alloc(sizeof(fsh_tls));
  t->ctx = ctx;
  t->ssl = ssl;
  pthread_mutex_init(&t->lock, NULL);
  return t;
}

static const fsh_tls_ops fsh_tls_calls;

// A listener's new connection, which handshakes as the server inside its first read or write.
static int fsh_tls_accepted(fsh_socket *listener, fsh_socket *conn) {
  SSL *ssl = SSL_new(((fsh_tls *)listener->tls)->ctx);
  if (!ssl) return 0;
  SSL_set_fd(ssl, conn->fd);
  SSL_set_accept_state(ssl);
  conn->tls = fsh_tls_new(NULL, ssl);
  conn->tls_ops = &fsh_tls_calls;
  return 1;
}

// Sends close_notify when it can without waiting, so the peer sees a clean end.
static void fsh_tls_release(fsh_socket *s) {
  fsh_tls *t = s->tls;
  if (t->ssl) {
    sigset_t before;
    FSH_TLS_QUIET(before);
    if (SSL_is_init_finished(t->ssl)) SSL_shutdown(t->ssl);
    SSL_free(t->ssl);
    ERR_clear_error();
    FSH_TLS_LOUD(before);
  }
  SSL_CTX_free(t->ctx);
  pthread_mutex_destroy(&t->lock);
  fsh_rt_free(t);
  s->tls = NULL;
}

static const fsh_tls_ops fsh_tls_calls = { fsh_tls_read, fsh_tls_write, fsh_tls_accepted, fsh_tls_release };

static SSL_CTX *fsh_tls_context(int server) {
  SSL_CTX *ctx = SSL_CTX_new(server ? TLS_server_method() : TLS_client_method());
  if (!ctx) return NULL;
  SSL_CTX_set_min_proto_version(ctx, TLS1_2_VERSION);
  // A peer that closes without close_notify ends the stream, as HTTP servers often do.
  SSL_CTX_set_options(ctx, SSL_OP_IGNORE_UNEXPECTED_EOF);
  if (!server) SSL_CTX_set_verify(ctx, SSL_VERIFY_PEER, NULL);
  return ctx;
}

// The client context trusting the system's certificates, made once, since loading them takes a
// while: OpenSSL's default paths, which a Homebrew OpenSSL points at the bundle it keeps.
static SSL_CTX *fsh_tls_system;
static pthread_once_t fsh_tls_system_once = PTHREAD_ONCE_INIT;
static void fsh_tls_system_load(void) {
  fsh_tls_system = fsh_tls_context(0);
  if (fsh_tls_system) SSL_CTX_set_default_verify_paths(fsh_tls_system);
}

// A BIO over a string's bytes.
static BIO *fsh_tls_bio(fsh_str *pem) {
  return BIO_new_mem_buf(pem->bytes, (int)pem->length);
}

static fsh_str *fsh_tls_said(const char *text) {
  return fsh_rt_str_from_cstring(text);
}

// Whether a name is a DNS host name: dot-separated labels of 1 to 63 letters, digits, hyphens and
// underscores, at most 253 bytes. What isn't one is refused here, before OpenSSL sees it.
// OpenSSL 4 refuses a few more, such as one-character names and labels starting or ending with
// a hyphen, which OpenSSL 3 checks against the certificate; those fail closed with the same error.
static int fsh_tls_host_name(const char *host) {
  size_t length = strlen(host), label = 0;
  if (length == 0 || length > 253) return 0;
  for (const char *c = host; *c; c++) {
    if (*c == '.') {
      if (label == 0) return 0;
      label = 0;
    } else if ((*c >= 'a' && *c <= 'z') || (*c >= 'A' && *c <= 'Z') || (*c >= '0' && *c <= '9') || *c == '-' || *c == '_') {
      if (++label > 63) return 0;
    } else return 0;
  }
  return label > 0;
}

// Starts TLS as the client on a connected stream, verifying the server's certificate for name, a
// host name or an IP address, against the PEM certificates in ca, or the system's when ca is
// empty, as the ca option takes it. Gives why it can't, or an empty string.
fsh_str *fsh_rt_tls_client(fsh_socket *s, fsh_str *name, fsh_str *ca) {
  if (s->sim) return fsh_tls_said("TLS is not supported in simulation mode (FISH_SIM_SEED)");
  // A second session would replace the first, leaking it and racing a read through a clone.
  if (s->tls) return fsh_tls_said("the stream already speaks TLS");
  char *host = fsh_rt_str_cstring(name);
  if (!host || !host[0]) {
    fsh_rt_free(host);
    return fsh_tls_said("the server name to verify is empty or holds a NUL byte");
  }
  SSL_CTX *ctx;
  if (ca->length == 0) {
    pthread_once(&fsh_tls_system_once, fsh_tls_system_load);
    ctx = fsh_tls_system;
    if (ctx) SSL_CTX_up_ref(ctx);
  } else {
    ctx = fsh_tls_context(0);
    int trusted = 0;
    if (ctx) {
      BIO *bio = fsh_tls_bio(ca);
      X509 *cert;
      while ((cert = PEM_read_bio_X509(bio, NULL, NULL, NULL))) {
        X509_STORE_add_cert(SSL_CTX_get_cert_store(ctx), cert);
        X509_free(cert);
        trusted++;
      }
      BIO_free(bio);
      ERR_clear_error();
    }
    if (ctx && !trusted) {
      SSL_CTX_free(ctx);
      fsh_rt_free(host);
      return fsh_tls_said("the 'ca' option holds no PEM certificate");
    }
  }
  SSL *ssl = ctx ? SSL_new(ctx) : NULL;
  if (!ssl) {
    SSL_CTX_free(ctx);
    fsh_rt_free(host);
    ERR_clear_error();
    return fsh_tls_said("can't set up TLS");
  }
  SSL_set_fd(ssl, s->fd);
  SSL_set_connect_state(ssl);
  // An absolute name's trailing dot names the same host. An address is checked
  // against the certificate's IP addresses and isn't sent as SNI, which takes only names. Any
  // name OpenSSL can't check against fails here, since a connection without the check would
  // take any certificate a trusted CA signed.
  size_t length = strlen(host);
  if (length > 1 && host[length - 1] == '.') host[--length] = 0;
  unsigned char address[16];
  int checked;
  if (inet_pton(AF_INET, host, address) == 1 || inet_pton(AF_INET6, host, address) == 1) checked = X509_VERIFY_PARAM_set1_ip_asc(SSL_get0_param(ssl), host);
  else checked = fsh_tls_host_name(host) && SSL_set_tlsext_host_name(ssl, host) && X509_VERIFY_PARAM_set1_host(SSL_get0_param(ssl), host, 0);
  if (!checked) {
    char text[400];
    snprintf(text, sizeof text, "'%.200s' isn't a host name or IP address a certificate can be checked against", host);
    SSL_free(ssl);
    SSL_CTX_free(ctx);
    fsh_rt_free(host);
    ERR_clear_error();
    return fsh_tls_said(text);
  }
  fsh_rt_free(host);
  s->tls = fsh_tls_new(ctx, ssl);
  s->tls_ops = &fsh_tls_calls;
  return fsh_tls_said("");
}

// Has a listener's connections speak TLS as the server, with the PEM certificate chain in cert
// and its private key in key. Gives why it can't, or an empty string.
fsh_str *fsh_rt_tls_listen(fsh_socket *listener, fsh_str *cert, fsh_str *key) {
  if (listener->sim) return fsh_tls_said("TLS is not supported in simulation mode (FISH_SIM_SEED)");
  SSL_CTX *ctx = fsh_tls_context(1);
  if (!ctx) return fsh_tls_said("can't set up TLS");
  const char *why = NULL;
  BIO *bio = fsh_tls_bio(cert);
  X509 *leaf = PEM_read_bio_X509(bio, NULL, NULL, NULL);
  if (!leaf || !SSL_CTX_use_certificate(ctx, leaf)) why = "the TLS 'cert' holds no PEM certificate";
  X509_free(leaf);
  X509 *more;
  while (!why && (more = PEM_read_bio_X509(bio, NULL, NULL, NULL))) {
    if (!SSL_CTX_add0_chain_cert(ctx, more)) X509_free(more);
  }
  BIO_free(bio);
  if (!why) {
    bio = fsh_tls_bio(key);
    EVP_PKEY *pkey = PEM_read_bio_PrivateKey(bio, NULL, NULL, NULL);
    BIO_free(bio);
    if (!pkey || !SSL_CTX_use_PrivateKey(ctx, pkey)) why = "the TLS 'key' holds no PEM private key";
    else if (!SSL_CTX_check_private_key(ctx)) why = "the TLS 'key' isn't the private key of the 'cert' certificate";
    EVP_PKEY_free(pkey);
  }
  ERR_clear_error();
  if (why) {
    SSL_CTX_free(ctx);
    return fsh_tls_said(why);
  }
  listener->tls = fsh_tls_new(ctx, NULL);
  listener->tls_ops = &fsh_tls_calls;
  return fsh_tls_said("");
}

// Into out, 32 bytes, 16 for MD5 and 20 for SHA-1: SHA-256 of data (0), HMAC-SHA-256 of data keyed by key (1),
// PBKDF2-HMAC-SHA-256 of the password key salted with data over rounds (2), MD5 of data (3), or
// SHA-1 of data (4).
// 1 when OpenSSL did it; each call's own success value is checked, as they differ.
int64_t fsh_rt_crypto_digest(int64_t which, const uint8_t *key, int64_t key_length, const uint8_t *data, int64_t length, int64_t rounds, uint8_t *out) {
  unsigned int n = 0;
  int ok = 0;
  switch (which) {
    case 0: ok = EVP_Digest(data, (size_t)length, out, &n, EVP_sha256(), NULL) == 1 && n == 32; break;
    case 1: ok = HMAC(EVP_sha256(), key, (int)key_length, data, (size_t)length, out, &n) != NULL && n == 32; break;
    case 2: ok = rounds > 0 && rounds <= INT_MAX && PKCS5_PBKDF2_HMAC((const char *)key, (int)key_length, data, (int)length, (int)rounds, EVP_sha256(), 32, out) == 1; break;
    case 3: ok = EVP_Digest(data, (size_t)length, out, &n, EVP_md5(), NULL) == 1 && n == 16; break;
    case 4: ok = EVP_Digest(data, (size_t)length, out, &n, EVP_sha1(), NULL) == 1 && n == 20; break;
  }
  ERR_clear_error();
  return ok;
}

// Why the crypto calls can't work: nothing, with OpenSSL linked.
const char *fsh_rt_crypto_missing(void) {
  return "";
}
`;

// The runtime's TLS calls where OpenSSL wasn't found: each says why and how to get it.
export function tlsStub(why: string): string {
  const said = JSON.stringify(why);
  return String.raw`
fsh_str *fsh_rt_tls_client(fsh_socket *s, fsh_str *name, fsh_str *ca) {
  return fsh_rt_str_from_cstring(${said});
}

fsh_str *fsh_rt_tls_listen(fsh_socket *listener, fsh_str *cert, fsh_str *key) {
  return fsh_rt_str_from_cstring(${said});
}

int64_t fsh_rt_crypto_digest(int64_t which, const uint8_t *key, int64_t key_length, const uint8_t *data, int64_t length, int64_t rounds, uint8_t *out) {
  return 0;
}

const char *fsh_rt_crypto_missing(void) {
  return ${said};
}
`;
}

// The zlib half of the runtime, a unit of its own compiled into a program, with -lz linked, only
// when its IR calls it. One call runs a whole compression or decompression into a buffer,
// then a second copies it out.
export const ZLIB_NATIVE = String.raw`
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <zlib.h>

// The most input given zlib at once, as its counts are 32-bit; a test lowers it to feed several.
#ifndef FSH_ZLIB_CHUNK
#define FSH_ZLIB_CHUNK UINT_MAX
#endif

// The output, or on failure zlib's message, and its length.
typedef struct { uint8_t *data; int64_t length; } fsh_zlib_run;

static void *fsh_zlib_grow(void *p, size_t n) {
  void *q = realloc(p, n ? n : 1);
  if (!q) {
    fputs("out of memory\n", stderr);
    exit(101);
  }
  return q;
}

// A failure: zlib's message when it gave one, else the message passed in.
static fsh_zlib_run *fsh_zlib_fail(z_stream *s, fsh_zlib_run *r, int err, const char *own, int64_t *result) {
  const char *message = s->msg ? s->msg : own;
  size_t n = strlen(message);
  r->data = fsh_zlib_grow(r->data, n);
  memcpy(r->data, message, n);
  r->length = (int64_t)n;
  result[0] = 1;
  result[1] = err;
  result[2] = r->length;
  return r;
}

// Deflates or inflates data whole. windowBits picks the format: 15 zlib, 31 gzip, -15 raw, and
// 47 either zlib or gzip when inflating, as unzip does. result is [failed, errno, length].
// limit, unless it is -1, is the most output a run may give: past it the run stops with result[0] 2.
fsh_zlib_run *fsh_rt_zlib_run(int64_t inflating, int64_t bits, int64_t level, const uint8_t *data, int64_t length, int64_t limit, int64_t *result) {
  fsh_zlib_run *r = fsh_zlib_grow(NULL, sizeof *r);
  r->data = NULL;
  r->length = 0;
  z_stream s;
  memset(&s, 0, sizeof s);
  int err = inflating ? inflateInit2(&s, (int)bits) : deflateInit2(&s, (int)level, Z_DEFLATED, (int)bits, 8, Z_DEFAULT_STRATEGY);
  if (err != Z_OK) return fsh_zlib_fail(&s, r, err, "Init error", result);
  // Concatenated gzip members are read as one; unzip does so once
  // its input starts as gzip.
  int members = bits == 31 || (bits == 47 && length >= 2 && data[0] == 0x1f && data[1] == 0x8b);
  size_t cap = inflating ? (size_t)length * 4 + 64 : deflateBound(&s, (uLong)length);
  r->data = fsh_zlib_grow(NULL, cap);
  const uint8_t *next = data;
  int64_t left = length;
  for (;;) {
    if (s.avail_in == 0 && left > 0) {
      s.next_in = (Bytef *)next;
      s.avail_in = left > FSH_ZLIB_CHUNK ? FSH_ZLIB_CHUNK : (uInt)left;
      next += s.avail_in;
      left -= s.avail_in;
    }
    if ((size_t)r->length == cap) {
      cap *= 2;
      r->data = fsh_zlib_grow(r->data, cap);
    }
    size_t room = cap - (size_t)r->length;
    s.next_out = r->data + r->length;
    s.avail_out = room > UINT_MAX ? UINT_MAX : (uInt)room;
    uInt before = s.avail_out;
    // Z_FINISH only once the last of the input is in: deflate would end the stream at the first chunk.
    int flush = left > 0 ? Z_NO_FLUSH : Z_FINISH;
    err = inflating ? inflate(&s, flush) : deflate(&s, flush);
    r->length += before - s.avail_out;
    if (limit >= 0 && r->length > limit) {
      if (inflating) inflateEnd(&s); else deflateEnd(&s);
      r->length = 0;
      result[0] = 2;
      result[1] = 0;
      result[2] = 0;
      return r;
    }
    if (err == Z_STREAM_END) {
      // Trailing zero bytes are padding; anything else starts another member.
      if (!inflating || !members || (s.avail_in == 0 && left == 0) || (s.avail_in > 0 ? *s.next_in : *next) == 0) break;
      inflateReset(&s);
      continue;
    }
    if (err == Z_OK || err == Z_BUF_ERROR) {
      if (s.avail_out == 0 || (s.avail_in == 0 && left > 0)) continue;
    }
    fsh_zlib_fail(&s, r, err, err == Z_NEED_DICT ? "Missing dictionary" : err == Z_OK || err == Z_BUF_ERROR ? "unexpected end of file" : "Zlib error", result);
    if (inflating) inflateEnd(&s); else deflateEnd(&s);
    return r;
  }
  if (inflating) inflateEnd(&s); else deflateEnd(&s);
  result[0] = 0;
  result[1] = 0;
  result[2] = r->length;
  return r;
}

// Copies a run's bytes, its output or its message, to out, and frees the run.
void fsh_rt_zlib_take(fsh_zlib_run *r, uint8_t *out) {
  if (r->length > 0) memcpy(out, r->data, (size_t)r->length);
  free(r->data);
  free(r);
}
`;

// The SQLite half of the runtime, a unit of its own compiled into a program, with -lsqlite3
// linked, only when its IR calls it. Std's sqlite module runs every call here on the blocking
// pool, a statement at a time for each connection.
export const SQLITE_NATIVE = String.raw`
#include <limits.h>
#include <pthread.h>
#include <sqlite3.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// A connection, counted: each Database sharing it, each statement made from it and each job
// running on it holds a count, and the last release closes it. db is NULL once close() has run.
// lock is held for a whole statement's run, so tasks sharing a connection take turns at it.
// error is the runtime's own message for the last failure, or NULL when SQLite holds it. before
// is the connection's total changes as a run began.
typedef struct {
  sqlite3 *db;
  pthread_mutex_t lock;
  int64_t refs;
  const char *error;
  int before;
} fsh_sqlite_db;

// A statement, counted like its connection, which it holds a count of, and the JSON of a row.
typedef struct {
  fsh_sqlite_db *db;
  sqlite3_stmt *stmt;
  int64_t refs;
  char *row;
  size_t length, cap;
} fsh_sqlite_stmt;

// Handles cross to Fish as integers: a blocking task may hold a number, never a raw pointer.
static fsh_sqlite_db *fsh_sqlite_db_of(int64_t handle) { return (fsh_sqlite_db *)(intptr_t)handle; }
static fsh_sqlite_stmt *fsh_sqlite_stmt_of(int64_t handle) { return (fsh_sqlite_stmt *)(intptr_t)handle; }

static void *fsh_sqlite_grow(void *p, size_t n) {
  void *q = realloc(p, n ? n : 1);
  if (!q) {
    fputs("out of memory\n", stderr);
    exit(101);
  }
  return q;
}

// A connection not yet opened, so its owner exists before the blocking task that opens it.
int64_t fsh_rt_sqlite_database(void) {
  fsh_sqlite_db *d = fsh_sqlite_grow(NULL, sizeof *d);
  d->db = NULL;
  d->refs = 1;
  d->error = NULL;
  d->before = 0;
  pthread_mutex_init(&d->lock, NULL);
  return (int64_t)(intptr_t)d;
}

// Opens the file at path, made if it isn't there, or a database in memory for ":memory:". A
// connection another holds waits up to five seconds for it rather than failing at once.
int64_t fsh_rt_sqlite_open(int64_t handle, const char *path) {
  fsh_sqlite_db *d = fsh_sqlite_db_of(handle);
  int rc = sqlite3_open_v2(path, &d->db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, NULL);
  if (rc == SQLITE_OK) sqlite3_busy_timeout(d->db, 5000);
  return rc & 0xff;
}

// The last failure's message, read before the connection's lock is given back.
const char *fsh_rt_sqlite_error(int64_t handle) {
  fsh_sqlite_db *d = fsh_sqlite_db_of(handle);
  return d->error ? d->error : sqlite3_errmsg(d->db);
}

void fsh_rt_sqlite_retain(int64_t handle) {
  __atomic_add_fetch(&fsh_sqlite_db_of(handle)->refs, 1, __ATOMIC_RELAXED);
}

void fsh_rt_sqlite_release(int64_t handle) {
  fsh_sqlite_db *d = fsh_sqlite_db_of(handle);
  if (__atomic_sub_fetch(&d->refs, 1, __ATOMIC_ACQ_REL) != 0) return;
  sqlite3_close_v2(d->db);
  pthread_mutex_destroy(&d->lock);
  free(d);
}

// Closes the connection for every holder. Statements still open keep SQLite's half alive until
// they are finalized, as sqlite3_close_v2 arranges, but run nothing more.
void fsh_rt_sqlite_close(int64_t handle) {
  fsh_sqlite_db *d = fsh_sqlite_db_of(handle);
  pthread_mutex_lock(&d->lock);
  sqlite3_close_v2(d->db);
  d->db = NULL;
  pthread_mutex_unlock(&d->lock);
}

int64_t fsh_rt_sqlite_statement(int64_t handle) {
  fsh_sqlite_stmt *s = fsh_sqlite_grow(NULL, sizeof *s);
  s->db = fsh_sqlite_db_of(handle);
  s->stmt = NULL;
  s->refs = 1;
  s->row = NULL;
  s->length = 0;
  s->cap = 0;
  fsh_rt_sqlite_retain(handle);
  return (int64_t)(intptr_t)s;
}

void fsh_rt_sqlite_statement_retain(int64_t handle) {
  __atomic_add_fetch(&fsh_sqlite_stmt_of(handle)->refs, 1, __ATOMIC_RELAXED);
}

void fsh_rt_sqlite_finalize(int64_t handle) {
  fsh_sqlite_stmt *s = fsh_sqlite_stmt_of(handle);
  pthread_mutex_lock(&s->db->lock);
  sqlite3_finalize(s->stmt);
  s->stmt = NULL;
  pthread_mutex_unlock(&s->db->lock);
}

void fsh_rt_sqlite_statement_release(int64_t handle) {
  fsh_sqlite_stmt *s = fsh_sqlite_stmt_of(handle);
  if (__atomic_sub_fetch(&s->refs, 1, __ATOMIC_ACQ_REL) != 0) return;
  // ponytail: a statement dropped unclosed while another task's statement runs on its connection
  // waits for that run on the thread dropping it; hand the finalize to the running job if a
  // program ever stalls there. One closed, or made for a single run, never waits.
  if (s->stmt) fsh_rt_sqlite_finalize(handle);
  free(s->row);
  fsh_rt_sqlite_release((int64_t)(intptr_t)s->db);
  free(s);
}

// Takes the connection for one statement's run, which fsh_rt_sqlite_unlock ends whether or not
// this refused it.
int64_t fsh_rt_sqlite_lock(int64_t handle) {
  fsh_sqlite_db *d = fsh_sqlite_stmt_of(handle)->db;
  pthread_mutex_lock(&d->lock);
  d->error = NULL;
  if (!d->db) {
    d->error = "the database is closed; open it again with Database.open";
    return SQLITE_MISUSE;
  }
  d->before = sqlite3_total_changes(d->db);
  return SQLITE_OK;
}

// Ends a run: a statement made for it alone is finalized, and any other reset, so that one
// stopped at its first row holds no lock on the database's file.
void fsh_rt_sqlite_unlock(int64_t handle, int64_t finalize) {
  fsh_sqlite_stmt *s = fsh_sqlite_stmt_of(handle);
  if (finalize) {
    sqlite3_finalize(s->stmt);
    s->stmt = NULL;
  } else if (s->stmt) sqlite3_reset(s->stmt);
  pthread_mutex_unlock(&s->db->lock);
}

int64_t fsh_rt_sqlite_prepare(int64_t handle, const char *sql, int64_t length) {
  fsh_sqlite_stmt *s = fsh_sqlite_stmt_of(handle);
  fsh_sqlite_db *d = s->db;
  if (length > INT_MAX) {
    d->error = "the SQL is longer than SQLite reads";
    return SQLITE_TOOBIG;
  }
  const char *tail = NULL;
  int rc = sqlite3_prepare_v2(d->db, sql, (int)length, &s->stmt, &tail);
  if (rc != SQLITE_OK) return rc & 0xff;
  if (!s->stmt) {
    d->error = "the SQL holds no statement";
    return SQLITE_ERROR;
  }
  // SQLite compiles the first statement and stops, so a second would be dropped unsaid. One that
  // doesn't compile is a second all the same: it may name a table the first has yet to make.
  sqlite3_stmt *second = NULL;
  rc = sqlite3_prepare_v2(d->db, tail, (int)(sql + length - tail), &second, NULL);
  if (rc == SQLITE_OK && !second) return SQLITE_OK;
  d->error = "the SQL holds more than one statement; run each with a call of its own";
  sqlite3_finalize(second);
  sqlite3_finalize(s->stmt);
  s->stmt = NULL;
  return SQLITE_ERROR;
}

// Readies a statement kept from an earlier run for another, its parameters all NULL again.
int64_t fsh_rt_sqlite_reset(int64_t handle) {
  fsh_sqlite_stmt *s = fsh_sqlite_stmt_of(handle);
  if (!s->stmt) {
    s->db->error = "the statement is closed; prepare it again";
    return SQLITE_MISUSE;
  }
  sqlite3_reset(s->stmt);
  sqlite3_clear_bindings(s->stmt);
  return SQLITE_OK;
}

int64_t fsh_rt_sqlite_parameters(int64_t handle) {
  return sqlite3_bind_parameter_count(fsh_sqlite_stmt_of(handle)->stmt);
}

int64_t fsh_rt_sqlite_bind_null(int64_t handle, int64_t at) {
  return sqlite3_bind_null(fsh_sqlite_stmt_of(handle)->stmt, (int)at) & 0xff;
}

int64_t fsh_rt_sqlite_bind_integer(int64_t handle, int64_t at, int64_t value) {
  return sqlite3_bind_int64(fsh_sqlite_stmt_of(handle)->stmt, (int)at, value) & 0xff;
}

int64_t fsh_rt_sqlite_bind_double(int64_t handle, int64_t at, double value) {
  return sqlite3_bind_double(fsh_sqlite_stmt_of(handle)->stmt, (int)at, value) & 0xff;
}

// SQLite copies the bytes, as the caller's last only as long as the call.
int64_t fsh_rt_sqlite_bind_text(int64_t handle, int64_t at, const char *text, int64_t length) {
  return sqlite3_bind_text64(fsh_sqlite_stmt_of(handle)->stmt, (int)at, text, (sqlite3_uint64)length, SQLITE_TRANSIENT, SQLITE_UTF8) & 0xff;
}

int64_t fsh_rt_sqlite_bind_blob(int64_t handle, int64_t at, const uint8_t *data, int64_t length) {
  return sqlite3_bind_blob64(fsh_sqlite_stmt_of(handle)->stmt, (int)at, data, (sqlite3_uint64)length, SQLITE_TRANSIENT) & 0xff;
}

// SQLITE_ROW at a row, SQLITE_DONE past the last, or what went wrong.
int64_t fsh_rt_sqlite_step(int64_t handle) {
  return sqlite3_step(fsh_sqlite_stmt_of(handle)->stmt) & 0xff;
}

static void fsh_sqlite_put(fsh_sqlite_stmt *s, const char *bytes, size_t n) {
  if (s->length + n > s->cap) {
    s->cap = (s->length + n) * 2;
    s->row = fsh_sqlite_grow(s->row, s->cap);
  }
  memcpy(s->row + s->length, bytes, n);
  s->length += n;
}

static void fsh_sqlite_put_text(fsh_sqlite_stmt *s, const unsigned char *text, size_t n) {
  fsh_sqlite_put(s, "\"", 1);
  for (size_t i = 0; i < n; i++) {
    unsigned char c = text[i];
    char escaped[8];
    if (c == '"' || c == '\\') {
      escaped[0] = '\\';
      escaped[1] = (char)c;
      fsh_sqlite_put(s, escaped, 2);
    } else if (c < 0x20) fsh_sqlite_put(s, escaped, (size_t)snprintf(escaped, sizeof escaped, "\\u%04x", c));
    else fsh_sqlite_put(s, (const char *)&c, 1);
  }
  fsh_sqlite_put(s, "\"", 1);
}

// The row the statement is at as a JSON object keyed by column name: an INTEGER and a REAL as
// numbers, TEXT as a string, a BLOB as an array of its bytes and NULL as null. The text is the
// statement's, good until its next row.
const char *fsh_rt_sqlite_row(int64_t handle) {
  fsh_sqlite_stmt *s = fsh_sqlite_stmt_of(handle);
  char number[32];
  s->length = 0;
  fsh_sqlite_put(s, "{", 1);
  int columns = sqlite3_column_count(s->stmt);
  for (int i = 0; i < columns; i++) {
    if (i > 0) fsh_sqlite_put(s, ",", 1);
    const char *name = sqlite3_column_name(s->stmt, i);
    if (!name) name = "";
    fsh_sqlite_put_text(s, (const unsigned char *)name, strlen(name));
    fsh_sqlite_put(s, ":", 1);
    switch (sqlite3_column_type(s->stmt, i)) {
      case SQLITE_INTEGER:
        fsh_sqlite_put(s, number, (size_t)snprintf(number, sizeof number, "%lld", (long long)sqlite3_column_int64(s->stmt, i)));
        break;
      case SQLITE_FLOAT: {
        double value = sqlite3_column_double(s->stmt, i);
        // JSON has no infinity, so one is written as a number past any f64, which reads back as it.
        if (value - value != 0) fsh_sqlite_put(s, value > 0 ? "1e999" : "-1e999", value > 0 ? 5 : 6);
        else fsh_sqlite_put(s, number, (size_t)snprintf(number, sizeof number, "%.17g", value));
        break;
      }
      case SQLITE_TEXT: {
        const unsigned char *text = sqlite3_column_text(s->stmt, i);
        fsh_sqlite_put_text(s, text, (size_t)sqlite3_column_bytes(s->stmt, i));
        break;
      }
      case SQLITE_BLOB: {
        const uint8_t *data = sqlite3_column_blob(s->stmt, i);
        int length = sqlite3_column_bytes(s->stmt, i);
        fsh_sqlite_put(s, "[", 1);
        for (int b = 0; b < length; b++) fsh_sqlite_put(s, number, (size_t)snprintf(number, sizeof number, b > 0 ? ",%d" : "%d", data[b]));
        fsh_sqlite_put(s, "]", 1);
        break;
      }
      default:
        fsh_sqlite_put(s, "null", 4);
    }
  }
  // The NUL after the brace goes in with it, as Fish reads the row as a C string.
  fsh_sqlite_put(s, "}", 2);
  return s->row;
}

// How many rows the run inserted, updated or deleted: SQLite keeps the last such statement's
// count, so a run that changed nothing is told apart by the connection's total.
// ponytail: SQLite's int counts, which wrap past 2^31 rows; sqlite3_changes64 once every
// system SQLite is 3.37 or newer.
int64_t fsh_rt_sqlite_changes(int64_t handle) {
  fsh_sqlite_db *d = fsh_sqlite_stmt_of(handle)->db;
  return sqlite3_total_changes(d->db) == d->before ? 0 : sqlite3_changes(d->db);
}

int64_t fsh_rt_sqlite_last_insert_rowid(int64_t handle) {
  return sqlite3_last_insert_rowid(fsh_sqlite_stmt_of(handle)->db->db);
}
`;
