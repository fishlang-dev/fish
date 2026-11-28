// Microcontroller builds: a program with no runtime and no libc, for a Cortex-M4F
// (thumbv7em-none-eabihf, laid out for QEMU's mps2-an386 board) or an ESP32-C3
// (riscv32imc-unknown-none-elf). What links in is a small board file: the reset entry, which sets
// up memory and calls main; memcpy and its kin, which clang's code calls; and the panic routines,
// which keep the message where a debugger finds it and halt. There is no heap unless the build
// declares a fixed arena, which then backs allocation and the growing of arrays. Anything else the
// program needs from the runtime fails the link, and the build names what it was.

export const BARE_METAL = ["thumbv7em-none-eabihf", "riscv32imc-unknown-none-elf"];

// Where each target's code and data go: QEMU's mps2-an386 runs code from SSRAM1 at 0 and keeps
// data in SSRAM2 at 0x20000000; an ESP32-C3 runs code from internal SRAM at 0x40380000 and keeps
// data in a part of that SRAM, seen at 0x3FCA0000, the code's part doesn't overlap.
function memoryOf(triple: string): string {
  if (triple.startsWith("thumb")) return "  CODE (rx) : ORIGIN = 0x00000000, LENGTH = 4M\n  DATA (rwx) : ORIGIN = 0x20000000, LENGTH = 4M";
  return "  CODE (rx) : ORIGIN = 0x40380000, LENGTH = 128K\n  DATA (rwx) : ORIGIN = 0x3FCA0000, LENGTH = 256K";
}

export function linkerScript(triple: string): string {
  return `ENTRY(fsh_mcu_reset)

MEMORY
{
${memoryOf(triple)}
}

SECTIONS
{
  .text : {
    KEEP(*(.vectors))
    *(.text .text.*)
    *(.rodata .rodata.* .srodata .srodata.*)
  } > CODE
  .ARM.exidx : { *(.ARM.exidx*) } > CODE
  .data : {
    __data_start = .;
    *(.data .data.* .sdata .sdata.*)
    __data_end = .;
  } > DATA AT > CODE
  __data_load = LOADADDR(.data);
  .bss (NOLOAD) : {
    __bss_start = .;
    *(.bss .bss.* .sbss .sbss.* COMMON)
    __bss_end = .;
  } > DATA
  __global_pointer$ = __data_start + 0x800;
  __stack_top = ORIGIN(DATA) + LENGTH(DATA);
}
`;
}

const BOARD = String.raw`#include <stddef.h>
#include <stdint.h>

int main(int argc, char **argv);
extern char __data_load[], __data_start[], __data_end[], __bss_start[], __bss_end[], __stack_top[];

void *memcpy(void *to, const void *from, size_t n) {
  unsigned char *d = to;
  const unsigned char *s = from;
  while (n--) *d++ = *s++;
  return to;
}

void *memmove(void *to, const void *from, size_t n) {
  unsigned char *d = to;
  const unsigned char *s = from;
  if (d < s) while (n--) *d++ = *s++;
  else while (n--) d[n] = s[n];
  return to;
}

void *memset(void *to, int c, size_t n) {
  unsigned char *d = to;
  while (n--) *d++ = (unsigned char)c;
  return to;
}

int memcmp(const void *a, const void *b, size_t n) {
  const unsigned char *x = a, *y = b;
  for (; n--; x++, y++) if (*x != *y) return *x - *y;
  return 0;
}

#ifdef __ARM_EABI__
// The ARM EABI's names for the same, which clang calls on ARM, with memset's arguments swapped.
void __aeabi_memcpy(void *to, const void *from, size_t n) { memcpy(to, from, n); }
void __aeabi_memcpy4(void *to, const void *from, size_t n) { memcpy(to, from, n); }
void __aeabi_memcpy8(void *to, const void *from, size_t n) { memcpy(to, from, n); }
void __aeabi_memmove(void *to, const void *from, size_t n) { memmove(to, from, n); }
void __aeabi_memmove4(void *to, const void *from, size_t n) { memmove(to, from, n); }
void __aeabi_memmove8(void *to, const void *from, size_t n) { memmove(to, from, n); }
void __aeabi_memset(void *to, size_t n, int c) { memset(to, c, n); }
void __aeabi_memset4(void *to, size_t n, int c) { memset(to, c, n); }
void __aeabi_memset8(void *to, size_t n, int c) { memset(to, c, n); }
void __aeabi_memclr(void *to, size_t n) { memset(to, 0, n); }
void __aeabi_memclr4(void *to, size_t n) { memset(to, 0, n); }
void __aeabi_memclr8(void *to, size_t n) { memset(to, 0, n); }
// Unwind tables name these, though nothing unwinds: a panic halts.
__attribute__((weak)) void __aeabi_unwind_cpp_pr0(void) {}
__attribute__((weak)) void __aeabi_unwind_cpp_pr1(void) {}
__attribute__((weak)) void __aeabi_unwind_cpp_pr2(void) {}
#endif

// The last panic's message, "panicked at file:line:col:" and its reason, for a debugger to read.
volatile const char *fsh_mcu_panic_message;
volatile int64_t fsh_mcu_panic_values[2];

__attribute__((noreturn)) static void fsh_mcu_halt(void) {
  for (;;) __asm__ volatile("wfi");
}

__attribute__((noreturn)) void fsh_rt_panic(const char *message) {
  fsh_mcu_panic_message = message;
  fsh_mcu_halt();
}

__attribute__((noreturn)) void fsh_rt_panic_bounds(const char *message, int64_t index, int64_t length) {
  fsh_mcu_panic_values[0] = index;
  fsh_mcu_panic_values[1] = length;
  fsh_rt_panic(message);
}

__attribute__((noreturn)) void fsh_rt_panic_index(const char *message, int64_t index, int64_t length) {
  fsh_rt_panic_bounds(message, index, length);
}

__attribute__((noreturn)) void fsh_rt_panic_assert(const char *at, const char *message) {
  (void)message;
  fsh_rt_panic(at);
}

// A program's arguments: a board has none.
void fsh_rt_args(int32_t argc, char **argv) {
  (void)argc;
  (void)argv;
}

#ifdef FSH_ARENA_BYTES
// The declared arena, given out from the bottom. Each block keeps its size before it, so freeing
// the newest block gives its room back; any other freed block's room stays used.
static _Alignas(8) unsigned char fsh_arena[FSH_ARENA_BYTES];
static size_t fsh_arena_used;

void *fsh_rt_alloc(int64_t size) {
  size_t need = ((size_t)size + 7) / 8 * 8 + 8;
  if (size < 0 || need > sizeof fsh_arena - fsh_arena_used) fsh_rt_panic("out of memory: the arena is full\n");
  unsigned char *block = fsh_arena + fsh_arena_used;
  *(size_t *)block = need;
  fsh_arena_used += need;
  return block + 8;
}

void fsh_rt_free(void *p) {
  if (!p) return;
  unsigned char *block = (unsigned char *)p - 8;
  if (block + *(size_t *)block == fsh_arena + fsh_arena_used) fsh_arena_used -= *(size_t *)block;
}

void *malloc(size_t size) { return fsh_rt_alloc((int64_t)size); }
void free(void *p) { fsh_rt_free(p); }
void *calloc(size_t n, size_t size) { return memset(fsh_rt_alloc((int64_t)(n * size)), 0, n * size); }
void *realloc(void *p, size_t size) {
  void *q = fsh_rt_alloc((int64_t)size);
  if (p) {
    size_t had = *(size_t *)((unsigned char *)p - 8) - 8;
    memcpy(q, p, had < size ? had : size);
    fsh_rt_free(p);
  }
  return q;
}

typedef struct { char *data; int64_t length; int64_t capacity; } fsh_array;

static void fsh_array_resize(fsh_array *a, int64_t capacity, int64_t size) {
  char *data = fsh_rt_alloc(capacity * size);
  if (a->length) memcpy(data, a->data, (size_t)(a->length * size));
  fsh_rt_free(a->data);
  a->data = data;
  a->capacity = capacity;
}

void fsh_rt_array_reserve(fsh_array *a, int64_t size) {
  if (a->length < a->capacity) return;
  fsh_array_resize(a, a->capacity ? a->capacity * 2 : 4, size);
}

void fsh_rt_array_grow(fsh_array *a, int64_t more, int64_t size, const char *at) {
  if (more < 0 || more > INT64_MAX / (size ? size : 1) - a->length) fsh_rt_panic(at);
  if (a->length + more <= a->capacity) return;
  fsh_array_resize(a, a->capacity * 2 > a->length + more ? a->capacity * 2 : a->length + more, size);
}

void *fsh_rt_array_alloc(int64_t bytes) {
  return bytes == 0 ? NULL : fsh_rt_alloc(bytes);
}

void *fsh_rt_array_zeroed(int64_t bytes) {
  void *p = fsh_rt_array_alloc(bytes);
  if (p) memset(p, 0, (size_t)bytes);
  return p;
}

void fsh_rt_bytes_copy(void *to, const void *from, int64_t count) {
  if (count > 0) memmove(to, from, (size_t)count);
}
#endif

static void fsh_mcu_start(void) {
  for (char *d = __data_start, *s = __data_load; d < __data_end;) *d++ = *s++;
  for (char *d = __bss_start; d < __bss_end;) *d++ = 0;
#ifdef __ARM_FP
  // The FPU is off at reset; code built for hard floats faults until CP10 and CP11 are on.
  *(volatile uint32_t *)0xE000ED88 |= 0xFu << 20;
  __asm__ volatile("dsb\n\tisb");
#endif
  main(0, 0);
  fsh_mcu_halt();
}

#ifdef __ARM_EABI__
// A Cortex-M starts with the stack pointer and the reset handler from the vector table.
void fsh_mcu_reset(void) {
  fsh_mcu_start();
}

// A fault halts as a panic does.
static void fsh_mcu_fault(void) {
  fsh_mcu_halt();
}

__attribute__((section(".vectors"), used)) static void *const fsh_mcu_vectors[16] = {
  [0] = __stack_top, [1] = (void *)fsh_mcu_reset, [2 ... 15] = (void *)fsh_mcu_fault,
};
#else
// A RISC-V core starts at the entry with no stack: set it, and the global pointer, first.
__attribute__((naked, section(".text.start"))) void fsh_mcu_reset(void) {
  __asm__ volatile(".option push\n\t.option norelax\n\tla gp, __global_pointer$\n\t.option pop\n\tla sp, __stack_top\n\tj fsh_mcu_start_c");
}

void fsh_mcu_start_c(void) {
  fsh_mcu_start();
}
#endif
`;

// The board file, with the arena when one is declared.
export function boardSource(arena: usize | undefined): string {
  return arena === undefined ? BOARD : `#define FSH_ARENA_BYTES ${arena}\n${BOARD}`;
}

// What the arena gives a program, so a link missing them without one says to declare it.
const HEAP = ["fsh_rt_alloc", "fsh_rt_free", "fsh_rt_array_alloc", "fsh_rt_array_zeroed", "fsh_rt_array_reserve", "fsh_rt_array_grow", "fsh_rt_bytes_copy", "malloc", "free", "calloc", "realloc"];

function needs(name: string, arena: boolean): string {
  if (HEAP.includes(name) && !arena) return "the heap; declare a fixed arena with --arena <bytes>";
  if (name.startsWith("fsh_rt_str_") || name.startsWith("fsh_rt_format_") || name === "printf" || name === "dprintf" || name === "fflush") return "strings or printing, which need the runtime; write to a peripheral's registers instead";
  if (name.startsWith("fsh_rt_array_")) return "an array operation the arena doesn't give; use push, indexing and length";
  return "the runtime, which a microcontroller build doesn't have";
}

// The error for a link that found `missing` undefined.
export function bareMetalRefusal(triple: string, missing: string[], arena: boolean): string {
  let names: string[] = [];
  for (const m of missing) if (!names.includes(m)) names.push(m);
  return [`fishc build: a ${triple} build has no runtime, and this program needs:`, ...names.map((n) => `  ${n}: ${needs(n, arena)}`)].join("\n");
}
