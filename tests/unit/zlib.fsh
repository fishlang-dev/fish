// The std `zlib` module against node's: the same body run by Fish in a directory of its own, its
// output compared with what node printed for it, as recorded. The body is TypeScript, its types
// stripped by node, which ran it as a `.cts` file. Where a test needs a second implementation at
// hand, to read what Fish wrote or write what Fish reads, perl's compressors are it.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compile, runtimeLinks, runtimeUnits } from "../../src/main.fsh";
import { ZLIB_NATIVE } from "../../src/native.fsh";
import { cachedSession } from "../../src/mathlib.fsh";
import { HOST_TARGET, sanitizedTarget } from "../../src/target.fsh";
import { built, fishc, ranFor, read, reference, removed, root, same, scratch, text } from "./support.fsh";

function fishHelpers(): string {
  return `
function show(b: Ref<u8[]>): string {
  return b.join(",");
}

function same(a: Ref<u8[]>, b: Ref<u8[]>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function errnoOf(e: Ref<ZlibError>): string {
  return e.errno === null ? "none" : String(e.errno);
}

function utf8(s: string): u8[] {
  return new TextEncoder().encode(s);
}

function text(b: Ref<u8[]>): string {
  return new TextDecoder().decode(b);
}
`;
}

// Node's calls take and give plain arrays here, as Fish's u8[] is one.
function nodeHelpers(): string {
  return `
const zlib = require("node:zlib");
const fs = require("node:fs");
const { promisify } = require("node:util");
const bytes = (d) => (Array.isArray(d) ? Buffer.from(d) : d);
const wrap = (f) => (d, o) => [...f(bytes(d), o)];
const wrapAsync = (f) => async (d, o) => [...(await promisify(f)(bytes(d), o))];
const [gzipSync, gunzipSync, deflateSync, inflateSync, deflateRawSync, inflateRawSync, unzipSync] = [zlib.gzipSync, zlib.gunzipSync, zlib.deflateSync, zlib.inflateSync, zlib.deflateRawSync, zlib.inflateRawSync, zlib.unzipSync].map(wrap);
const [gzip, gunzip, deflate, inflate, deflateRaw, inflateRaw, unzip] = [zlib.gzip, zlib.gunzip, zlib.deflate, zlib.inflate, zlib.deflateRaw, zlib.inflateRaw, zlib.unzip].map(wrapAsync);
const constants = zlib.constants;
const readFileSync = (p) => [...fs.readFileSync(p)];
const writeFileSync = (p, d) => fs.writeFileSync(p, bytes(d));
const show = (b) => b.join(",");
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const errnoOf = (e) => (e.errno === undefined ? "none" : String(e.errno));
const utf8 = (s) => [...new TextEncoder().encode(s)];
const text = (b) => new TextDecoder().decode(Uint8Array.from(b));
Object.defineProperty(Array.prototype, "clone", { value() { return this.slice(); } });
`;
}

function names(): string[] {
  return ["gzipSync", "gunzipSync", "deflateSync", "inflateSync", "deflateRawSync", "inflateRawSync", "unzipSync", "gzip", "gunzip", "deflate", "inflate", "deflateRaw", "inflateRaw", "unzip", "constants"];
}

function wordChar(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_";
}

// Whether `body` names `n` as a whole word followed by a call or a member, as the regex
// `\b${n}[(.]` would ask.
function named(body: string, n: string): boolean {
  const size = n.length as i64;
  let at = body.indexOf(n);
  while (at >= 0) {
    const after = body.slice(at + size, at + size + 1);
    const before = at === 0 ? "" : body.slice(at - 1, at);
    if ((after === "(" || after === ".") && (before === "" || !wordChar(before))) return true;
    at = body.indexOf(n, at + 1);
  }
  return false;
}

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

function made(path: string): string {
  try {
    mkdirSync(path);
  } catch (e) {
    assert(false, `can't make ${path}: ${e.message}`);
  }
  return path;
}

// Runs `body` as a Fish program in a directory of its own made by `setup`, a shell command run
// there first, and compares what it prints with what node printed for it in such a directory, as
// recorded; gives the two directories.
function compare(tmp: string, name: string, body: string, setup: string): [string, string] {
  const fishDir = made(join(tmp, `${name}-fish`));
  const nodeDir = made(join(tmp, `${name}-node`));
  if (setup !== "") {
    for (const dir of [fishDir, nodeDir]) {
      const done = spawnSync("sh", ["-c", setup], { cwd: dir });
      same(text(done.stderr), "", `setting up ${dir}`);
    }
  }
  const async = body.includes("await ");
  const used = names().filter((n) => named(body, n));
  const imports = `import { ${used.join(", ")}, ZlibError } from "node:zlib";\nimport { readFileSync, writeFileSync } from "node:fs";`;
  const out = built(tmp, name, `${imports}\n${fishHelpers()}\n${async ? "async " : ""}function main(): ${async ? "Promise<void>" : "void"} throws ZlibError | IoError {${body}\n}\n`);
  const fish = spawnSync("env", ["FISH_LEAKS=1", out], { cwd: fishDir });
  const script = join(tmp, `${name}.cts`);
  write(script, `${nodeHelpers()}\n(${async ? "async " : ""}() => {${body}\n})();\n`);
  const node = reference(`zlib-${name}`, `${nodeHelpers()}\n${body}\n${setup.replaceAll(tmp, "<tmp>")}`, () => ranFor("node", [script], nodeDir));
  same(text(fish.stderr), "", `${name}'s stderr`);
  same(node.stderr, "", `node's stderr for ${name}`);
  same(text(fish.stdout), node.stdout, `${name}'s output`);
  assert(fish.stdout.length > 0, `${name} printed nothing`);
  return [fishDir, nodeDir];
}

test("small inputs compress to node's bytes at every level, and decompress", () => {
  const tmp = scratch("fish-zlib-");
  compare(tmp, "small", `
  const inputs = ["", "hello", "héllo 👍", "abcabcabc ".repeat(400)];
  for (const input of inputs) {
    for (let level = -1; level <= 9; level++) {
      const gz = gzipSync(input, { level });
      const df = deflateSync(input, { level });
      const raw = deflateRawSync(input, { level });
      console.log(level, gz.length > 0, df.length > 0, raw.length > 0);
      // Chromium's zlib, node's, takes other matches at level 1 on long repetitive input.
      if (level !== 1 || input.length < 1000) {
        console.log(show(gz));
        console.log(show(df));
        console.log(show(raw));
      }
      console.log(text(gunzipSync(gz.clone())) === input, text(inflateSync(df.clone())) === input, text(inflateRawSync(raw)) === input);
      console.log(text(unzipSync(gz)) === input, text(unzipSync(df)) === input);
    }
  }
  const bytes: u8[] = [0, 1, 2, 255];
  console.log(show(gzipSync(bytes.clone())), show(gunzipSync(gzipSync(bytes))));
  console.log(constants.Z_NO_COMPRESSION, constants.Z_BEST_SPEED, constants.Z_BEST_COMPRESSION, constants.Z_DEFAULT_COMPRESSION);
  console.log(show(gzipSync("x", { level: constants.Z_BEST_COMPRESSION })), show(gzipSync("x", {})));`, "");
  removed(tmp);
}, { timeout: 30_000 });

// Text that deflates in several blocks, with long and short matches.
function large(): string {
  let letters: string[] = [];
  for (let i: i64 = 0; i < 200000; i++) letters.push(String.fromCharCode((97 + ((i * i * 7 + i) % 26)) as u16) + (i % 13 === 0 ? " " : ""));
  // Then words in an order a fixed seed gives, so the text is the same wherever it is made and the
  // answer recorded for it holds.
  const words = ["const", "return", "function", "string", "import", "export", "while", "await", "(", ")", "{", "}", ";", "=>", "\n", "  "];
  let seed: i64 = 7;
  let drawn: string[] = [];
  for (let i = 0; i < 120000; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    drawn.push(words[(seed % 16) as usize]!);
  }
  return letters.join("") + drawn.join(" ");
}

test("a large input round-trips with another implementation both ways", () => {
  const tmp = scratch("fish-zlib-");
  const big = join(tmp, "big.txt");
  write(big, large());
  // Perl's own compressors make what Fish reads, and its decompressors read what Fish makes: an
  // implementation that isn't Fish's, on every system the tests run on.
  const setup = `cp "${big}" big.txt && perl -MIO::Compress::Gzip=gzip -MIO::Compress::Deflate=deflate -MIO::Compress::RawDeflate=rawdeflate -e 'gzip("big.txt" => "made.gz") or die; deflate("big.txt" => "made.z", Level => 1) or die; rawdeflate("big.txt" => "made.raw", Level => 9) or die;'`;
  const [fishDir, _nodeDir] = compare(tmp, "large", `
  const big = readFileSync("big.txt");
  const back = [gunzipSync(readFileSync("made.gz")), inflateSync(readFileSync("made.z")), inflateRawSync(readFileSync("made.raw")), unzipSync(readFileSync("made.gz")), unzipSync(readFileSync("made.z"))];
  for (const b of back) console.log(b.length, same(b, big));
  writeFileSync("out.gz", gzipSync(big.clone()));
  writeFileSync("out.z", deflateSync(big.clone(), { level: 1 }));
  writeFileSync("out.raw", deflateRawSync(big.clone(), { level: 9 }));
  writeFileSync("out0.gz", gzipSync(big, { level: 0 }));`, setup);
  const check = spawnSync("perl", ["-MIO::Uncompress::Gunzip=gunzip", "-MIO::Uncompress::Inflate=inflate", "-MIO::Uncompress::RawInflate=rawinflate", "-e", `local $/; open F, "<", "big.txt" or die; binmode F; my $big = <F>; my @r; for (["out.gz", \\&gunzip], ["out.z", \\&inflate], ["out.raw", \\&rawinflate], ["out0.gz", \\&gunzip]) { my $o; $_->[1]->($_->[0] => \\$o) or die; push @r, ($o eq $big ? "true" : "false"); } print "@r\\n";`], { cwd: fishDir });
  same(text(check.stderr), "", "perl's stderr reading Fish's output");
  same(text(check.stdout), "true true true true\n", "perl decompressing Fish's output");
  removed(tmp);
}, { timeout: 30_000 });

test("corrupt input fails with node's message, errno and code", () => {
  const tmp = scratch("fish-zlib-");
  compare(tmp, "corrupt", `
  const gz = gzipSync("a");
  const df = deflateSync("abc");
  const cases: u8[][] = [
    utf8("hello"),
    [],
    gz.slice(0, 10),
    gz.concat([0x1f]),
    gz.concat([0x1f, 0x8b]),
    gz.concat([0, 0, 0]),
    gz.concat(gzipSync("b")).concat(gzipSync("")),
    gz.concat(utf8("xyz")),
    [0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3, 0x4b, 4, 0, 0x43, 0xbe, 0xb7, 0xe9, 1, 0, 0, 0],
    [0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3, 0x4b, 4, 0, 0x43, 0xbe, 0xb7, 0xe8, 2, 0, 0, 0],
    df.slice(0, (df.length - 1) as i64).concat([(df[df.length - 1] ^ 1) as u8]),
    df.slice(0, 5),
    df.concat(utf8("xyz")),
    df.concat(deflateSync("b")),
    [1, 2, 3],
    [0x78, 0xbb, 0, 0, 0, 1],
  ];
  for (const c of cases) {
    for (const which of ["gunzip", "inflate", "inflateRaw", "unzip"]) {
      try {
        const out = which === "gunzip" ? gunzipSync(c.clone()) : which === "inflate" ? inflateSync(c.clone()) : which === "inflateRaw" ? inflateRawSync(c.clone()) : unzipSync(c.clone());
        console.log(which, "gives", show(out));
      } catch (e) {
        console.log(which, e.message, errnoOf(e), e.code);
      }
    }
  }`, "");
  removed(tmp);
}, { timeout: 30_000 });

test("a level out of range is node's range error, for every call", () => {
  const tmp = scratch("fish-zlib-");
  compare(tmp, "level", `
  for (const level of [10, -2, 12, 4294967296, 4294967297, -10000000000]) {
    try {
      gzipSync("x", { level });
    } catch (e) {
      console.log(e.message, errnoOf(e), e.code, e.name);
    }
    try {
      inflateSync("x", { level });
    } catch (e) {
      console.log(e.message, errnoOf(e), e.code);
    }
  }`, "");
  removed(tmp);
}, { timeout: 30_000 });

function irOf(tmp: string, name: string, src: string): string {
  const file = join(tmp, name);
  write(file, src);
  try {
    return compile(cachedSession(), src, file);
  } catch (e) {
    assert(false, `${name}: ${e.message}`);
    return "";
  }
}

function unitNames(ir: string): string[] {
  try {
    return runtimeUnits(ir, false).map((u) => u.name);
  } catch (e) {
    assert(false, `runtimeUnits: ${e.message}`);
    return [];
  }
}

test("zlib is compiled and linked into a program only when it calls the module", () => {
  const tmp = scratch("fish-zlib-");
  const using = irOf(tmp, "using.fsh", `import { gzipSync, ZlibError } from "node:zlib";\nfunction main(): void throws ZlibError { console.log(gzipSync("x").length); }\n`);
  const plain = irOf(tmp, "plain.fsh", `function main() { console.log(new TextEncoder().encode("x").length); }\n`);
  assert(runtimeLinks(using, HOST_TARGET).includes("-lz"), "the program calling zlib doesn't link -lz");
  assert(unitNames(using).includes("zlib"), "the program calling zlib has no zlib unit");
  assert(!runtimeLinks(plain, HOST_TARGET).includes("-lz"), "the plain program links -lz");
  assert(!unitNames(plain).includes("zlib"), "the plain program has a zlib unit");
  removed(tmp);
}, { timeout: 30_000 });

test("the promise forms give what node's promisified calls give", () => {
  const tmp = scratch("fish-zlib-");
  compare(tmp, "promises", `
  const gz = await gzip("hello", { level: 9 });
  const df = await deflate("hello");
  const raw = await deflateRaw(utf8("hello"), { level: 1 });
  console.log(show(gz), show(df), show(raw));
  const a = await gunzip(gz.clone());
  const b = await inflate(df.clone());
  const c = await inflateRaw(raw);
  const d = await unzip(gz);
  const e = await unzip(df);
  console.log(text(a), text(b), text(c), text(d), text(e));
  const big = utf8("abcdefgh ".repeat(5000));
  const squeezed = await deflate(big.clone());
  const size = squeezed.length;
  const again = await inflate(squeezed);
  console.log(size > 0, same(again, big));
  try {
    await gunzip("hello");
  } catch (e) {
    console.log(e.message, errnoOf(e), e.code);
  }
  try {
    await inflateRaw([]);
  } catch (e) {
    console.log(e.message, errnoOf(e), e.code);
  }
  try {
    await deflate("x", { level: 10 });
  } catch (e) {
    console.log(e.message, errnoOf(e), e.code);
  }`, "");
  removed(tmp);
}, { timeout: 30_000 });

function harness(): string {
  return `
#include <stdint.h>
#include <stdio.h>
#include <string.h>
typedef struct { uint8_t *data; int64_t length; } fsh_zlib_run;
fsh_zlib_run *fsh_rt_zlib_run(int64_t, int64_t, int64_t, const uint8_t *, int64_t, int64_t, int64_t *);
void fsh_rt_zlib_take(fsh_zlib_run *, uint8_t *);
static uint8_t in[100000], packed[200000], back[100000];
int main(void) {
  for (int i = 0; i < 100000; i++) in[i] = (uint8_t)('a' + ((int64_t)i * i * 7 + i) % 26);
  int bits[] = {15, 31, -15};
  for (int k = 0; k < 3; k++) {
    int64_t r[3];
    fsh_zlib_run *run = fsh_rt_zlib_run(0, bits[k], 6, in, sizeof in, -1, r);
    int64_t n = r[2];
    fsh_rt_zlib_take(run, packed);
    char name[16];
    snprintf(name, sizeof name, "out%d", k);
    FILE *f = fopen(name, "wb");
    fwrite(packed, 1, n, f);
    fclose(f);
    run = fsh_rt_zlib_run(1, bits[k], -1, packed, n, -1, r);
    int64_t m = r[2];
    fsh_rt_zlib_take(run, back);
    printf("%d %lld %d\\n", (int)r[0], (long long)m, m == (int64_t)sizeof in && memcmp(in, back, sizeof in) == 0);
  }
  return 0;
}
`;
}

// Input past zlib's 32-bit counts is fed in chunks; built with a 1000-byte chunk, the runtime must
// still compress and decompress the whole of a larger input.
test("input fed to zlib in several chunks is compressed and decompressed whole", () => {
  const dir = scratch("fish-zlib-");
  write(join(dir, "zlib.c"), ZLIB_NATIVE);
  write(join(dir, "main.c"), harness());
  const clang = spawnSync("clang", ["-DFSH_ZLIB_CHUNK=1000", "zlib.c", "main.c", "-lz", "-o", "main"], { cwd: dir });
  same(text(clang.stderr), "", "clang's stderr");
  const ran = spawnSync(join(dir, "main"), [], { cwd: dir });
  same(text(ran.stdout), "0 100000 1\n".repeat(3), "the harness's output");
  const check = spawnSync("perl", ["-MIO::Uncompress::Gunzip=gunzip", "-MIO::Uncompress::Inflate=inflate", "-MIO::Uncompress::RawInflate=rawinflate", "-e", `my $input = join "", map { chr(97 + (($_ * $_ * 7 + $_) % 26)) } 0 .. 99999; my @r; for (["out0", \\&inflate], ["out1", \\&gunzip], ["out2", \\&rawinflate]) { my $o; $_->[1]->($_->[0] => \\$o) or die; push @r, ($o eq $input ? "true" : "false"); } print "@r\\n";`], { cwd: dir });
  same(text(check.stderr), "", "perl's stderr");
  same(text(check.stdout), "true true true\n", "perl decompressing the harness's output");
  removed(dir);
}, { timeout: 30_000 });

// Whether clang can build for the host with the address sanitizer.
function asan(): boolean {
  try {
    sanitizedTarget(HOST_TARGET.clone(), ["address"]);
    return true;
  } catch (_e) {
    return false;
  }
}

// A promise form whose future is dropped, losing a race, leaves its job running on the blocking
// pool; the job reads its own copy of the input, so the memory reused meanwhile is never its own.
// Skipped, saying so, where clang can't build with the address sanitizer.
test("a promise form that loses a race finishes its job on memory of its own", () => {
  if (!asan()) {
    console.log("skipped: clang can't build for the host with the address sanitizer");
    return;
  }
  const dir = scratch("fish-zlib-");
  write(join(dir, "main.fsh"), `import { deflate, ZlibError } from "node:zlib";

async function main(): Promise<void> throws ZlibError {
  let input: u8[] = [];
  let x = 1;
  for (let i = 0; i < 8000000; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    input.push(((x >> 16) & 7) as u8);
  }
  const r = await Promise.race([deflate(input, { level: 9 }), sleep(1)]);
  console.log(r === undefined ? "sleep won" : "deflate won");
  let total = 0;
  for (let k = 0; k < 50; k++) {
    let junk: u8[] = new Array(1000000).fill(7 as u8);
    total += junk[k] as i64;
  }
  await sleep(3000);
  console.log("done", total);
}
`);
  const build = fishc(dir, ["build", "main.fsh", "-o", "main", "--sanitize", "address"]);
  assert(build.code === 0, `the build exited with ${build.code}: ${build.err}`);
  const ran = spawnSync("env", ["FISH_LEAKS=1", join(dir, "main")], { cwd: dir });
  same(text(ran.stderr), "", "the program's stderr");
  same(text(ran.stdout), "sleep won\ndone 350\n", "the program's output");
  removed(dir);
}, { timeout: 30_000 });
