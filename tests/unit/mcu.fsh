// Microcontroller builds: the board file, the linker script and the refusals, in process, and
// images built by the native fishc. Building one needs Homebrew's LLVM, lld and the GNU
// bare-metal toolchains: FISH_TEST_ESP32C3=1 links an ESP32-C3 image and checks the refusals,
// and FISH_TEST_QEMU_ARM names qemu-system-arm, which runs Cortex-M4 images on mps2-an386.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bareMetalRefusal, boardSource, linkerScript } from "../../src/mcu.fsh";
import { resolveTarget, type Target } from "../../src/target.fsh";
import { fishc, removed, same, scratch } from "./support.fsh";

function none(_tool: string): string | null {
  return null;
}

function thrown(run: () => Target throws Error): string {
  try {
    const _t = run();
    return "";
  } catch (e) {
    return e.message;
  }
}

test("the board file and linker script place each target's memory", () => {
  const arm = linkerScript("thumbv7em-none-eabihf");
  assert(arm.includes("CODE (rx) : ORIGIN = 0x00000000, LENGTH = 4M") && arm.includes("DATA (rwx) : ORIGIN = 0x20000000, LENGTH = 4M"), `the ARM script:\n${arm}`);
  assert(linkerScript("riscv32imc-unknown-none-elf").includes("ORIGIN = 0x40380000"), "the ESP32-C3 script runs code from internal SRAM");
  assert(!boardSource(undefined).startsWith("#define FSH_ARENA_BYTES"), "no arena unless one is declared");
  assert(boardSource(4096).startsWith("#define FSH_ARENA_BYTES 4096\n"), "a declared arena's size");
});

test("a link missing the runtime names what the program needs", () => {
  same(bareMetalRefusal("thumbv7em-none-eabihf", ["printf", "fsh_rt_array_reserve", "printf", "fsh_rt_map_new"], false), `fishc build: a thumbv7em-none-eabihf build has no runtime, and this program needs:
  printf: strings or printing, which need the runtime; write to a peripheral's registers instead
  fsh_rt_array_reserve: the heap; declare a fixed arena with --arena <bytes>
  fsh_rt_map_new: the runtime, which a microcontroller build doesn't have`, "the refusal");
  assert(bareMetalRefusal("riscv32imc-unknown-none-elf", ["fsh_rt_array_take"], true).includes("an array operation the arena doesn't give"), "an array operation past the arena's");
});

test("a microcontroller target says which tool it lacks", () => {
  const darwin = process.platform === "darwin";
  const noClang = thrown(() => resolveTarget("thumbv7em-none-eabihf", undefined, undefined, none, (_p) => false));
  assert(noClang.includes("needs clang with the ARM backend"), `no clang: ${noClang}`);
  if (darwin) {
    const noLld = thrown(() => resolveTarget("riscv32imc-unknown-none-elf", undefined, undefined, none, (_p) => true));
    assert(noLld.includes("links with ld.lld, which isn't on PATH"), `no lld: ${noLld}`);
  }
});

// A Cortex-M4 program writing to the CMSDK UART QEMU's mps2-an386 has at 0x40004000.
const UART = `import { registers } from "std:mcu";

@registers(0x40004000)
class Uart0 {
  data: u32;
  state: u32;
  ctrl: u32;
  intStatus: u32;
  baudDiv: u32;
}

function put(c: u32): void {
  unsafe {
    while ((Uart0.state().readVolatile() & 1) !== 0) {}
    Uart0.data().writeVolatile(c);
  }
}

function number(n: i64): void {
  if (n >= 10) number(n / 10);
  put(48 + ((n % 10) as u32));
}

function start(): void {
  unsafe {
    Uart0.baudDiv().writeVolatile(16);
    Uart0.ctrl().writeVolatile(1);
  }
}
`;

const SUMS = `${UART}
function main() {
  start();
  let total: i64 = 0;
  for (let i = 1; i <= 10; i++) total += i;
  const half = (total as f64) / 2;
  put(102);
  put(32);
  number(total);
  put(32);
  number(half as i64);
  put(10);
}
`;

const ARENA = `${UART}
function main() {
  start();
  let xs: i64[] = [];
  for (let i = 1; i <= 100; i++) xs.push(i * i);
  number(xs.length as i64);
  put(32);
  number(xs[99]!);
  put(10);
}
`;

const PANICS = `${UART}
function divide(a: i64, b: i64): i64 {
  return a / b;
}

function main() {
  start();
  put(97);
  put(10);
  number(divide(1, 0));
  put(98);
}
`;

// Writes `text` to `path`, failing the test if it can't.
function wrote(path: string, text: string): void {
  try {
    writeFileSync(path, text);
  } catch (e) {
    assert(false, `writing ${path}: ${e.message}`);
  }
}

// Builds `source` for `triple` in `dir` as `name`, failing the test unless it builds.
function built(dir: string, name: string, source: string, triple: string, more: string[] = []): string {
  wrote(join(dir, `${name}.fsh`), source);
  const run = fishc(dir, ["build", `${name}.fsh`, "--target", triple, ...more]);
  same(`${run.code} ${run.err}`, "0 ", `building ${name}`);
  return join(dir, name);
}

// What the image printed on the UART in the seconds QEMU ran it, halted or not.
function qemu(binary: string, image: string): string {
  const run = spawnSync("sh", ["-c", `"$0" -machine mps2-an386 -display none -monitor none -serial stdio -kernel "$1" & q=$!; sleep 3; kill $q 2>/dev/null; wait $q 2>/dev/null; true`, binary, image]);
  return new TextDecoder().decode(run.stdout);
}

test("Cortex-M4 images run under QEMU, a panic halting", () => {
  const binary = process.env.FISH_TEST_QEMU_ARM ?? "";
  if (binary === "") {
    console.log("skipped: running a Cortex-M4 image needs FISH_TEST_QEMU_ARM, the path to qemu-system-arm, with Homebrew's LLVM, lld and arm-none-eabi-gcc");
    return;
  }
  const dir = scratch("fish-mcu-arm-");
  same(qemu(binary, built(dir, "sums", SUMS, "thumbv7em-none-eabihf")), "f 55 27\n", "the debug build's output");
  same(qemu(binary, built(dir, "fast", SUMS, "thumbv7em-none-eabihf", ["--release", "-o", "fast"])), "f 55 27\n", "the release build's output");
  same(qemu(binary, built(dir, "arena", ARENA, "thumbv7em-none-eabihf", ["--arena", "4096"])), "100 10000\n", "the arena build's output");
  same(qemu(binary, built(dir, "panics", PANICS, "thumbv7em-none-eabihf")), "a\n", "a panic halts before anything after it");
  removed(dir);
}, { timeout: 600_000 });

test("ESP32-C3 images link, and what needs a runtime is refused", () => {
  if ((process.env.FISH_TEST_ESP32C3 ?? "") !== "1") {
    console.log("skipped: linking an ESP32-C3 image needs FISH_TEST_ESP32C3=1, with Homebrew's LLVM, lld and riscv64-elf-gcc");
    return;
  }
  const dir = scratch("fish-mcu-riscv-");
  let bytes: u8[] = [];
  try {
    bytes = readFileSync(built(dir, "sums", SUMS, "riscv32imc-unknown-none-elf"));
  } catch (e) {
    assert(false, `the image: ${e.message}`);
  }
  // An ELF file: 32-bit, little-endian, an executable for RISC-V (machine 0xF3).
  assert(bytes[0]! === 0x7f && bytes[1]! === 0x45 && bytes[2]! === 0x4c && bytes[3]! === 0x46, "an ELF header");
  assert(bytes[4]! === 1 && bytes[5]! === 1, "32-bit and little-endian");
  assert(bytes[16]! === 2 && bytes[18]! === 0xf3 && bytes[19]! === 0, "a RISC-V executable");
  wrote(join(dir, "prints.fsh"), `function main() {\n  console.log("hello");\n}\n`);
  const prints = fishc(dir, ["build", "prints.fsh", "--target", "riscv32imc-unknown-none-elf"]);
  assert(prints.code === 1 && prints.err.includes("has no runtime, and this program needs:") && prints.err.includes("printf: strings or printing"), `printing: ${prints.err}`);
  wrote(join(dir, "grows.fsh"), ARENA);
  const grows = fishc(dir, ["build", "grows.fsh", "--target", "riscv32imc-unknown-none-elf"]);
  assert(grows.code === 1 && grows.err.includes("declare a fixed arena with --arena <bytes>"), `an array with no arena: ${grows.err}`);
  const lib = fishc(dir, ["build", "grows.fsh", "--target", "riscv32imc-unknown-none-elf", "--lib"]);
  assert(lib.code === 1 && lib.err.includes("leave out '--lib'"), `a library: ${lib.err}`);
  removed(dir);
}, { timeout: 600_000 });
