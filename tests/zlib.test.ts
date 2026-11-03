import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync, deflateSync, gunzipSync, gzipSync, inflateRawSync, inflateSync } from "node:zlib";
import { compile, runtimeLinks, runtimeUnits } from "../src/main.ts";
import { cachedSession } from "../src/stdcache.ts";
import { HOST_TARGET } from "../src/target.ts";

// Each test builds a program with clang, which can take past bun's 5 seconds on a busy CI runner.
setDefaultTimeout(30_000);

// The std `zlib` module against node's: the same body run by both in a directory of its own,
// output compared. The body is TypeScript, its types stripped for node.
const tmp = mkdtempSync(join(tmpdir(), "fish-zlib-"));

const FISH_HELPERS = `
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

// Node's calls take and give plain arrays here, as Fish's u8[] is one.
const NODE_HELPERS = `
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

const NAMES = "gzipSync, gunzipSync, deflateSync, inflateSync, deflateRawSync, inflateRawSync, unzipSync, gzip, gunzip, deflate, inflate, deflateRaw, inflateRaw, unzip, constants";
const transpiler = new Bun.Transpiler({ loader: "ts" });

function compare(name: string, body: string, setup: (dir: string) => void = () => {}) {
  const fishDir = mkdtempSync(join(tmp, `${name}-fish-`));
  const nodeDir = mkdtempSync(join(tmp, `${name}-node-`));
  setup(fishDir);
  setup(nodeDir);
  const program = join(tmp, `${name}.fsh`);
  const async = body.includes("await ");
  const imports = `import { ${NAMES.split(", ").filter((n) => new RegExp(`\\b${n}[(.]`).test(body)).join(", ")}, ZlibError } from "node:zlib";\nimport { readFileSync, writeFileSync } from "node:fs";`;
  writeFileSync(program, `${imports}\n${FISH_HELPERS}\n${async ? "async " : ""}function main(): ${async ? "Promise<void>" : "void"} throws ZlibError | IoError {${body}\n}\n`);
  const out = join(tmp, name);
  const built = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out]);
  expect(built.stderr.toString()).toBe("");
  const fish = Bun.spawnSync([out], { cwd: fishDir, env: { ...process.env, FISH_LEAKS: "1" } });
  const js = transpiler.transformSync(`(${async ? "async " : ""}() => {${body}\n})();`);
  const node = Bun.spawnSync(["node", "-e", `${NODE_HELPERS}\n${js}`], { cwd: nodeDir });
  expect(fish.stderr.toString()).toBe("");
  expect(node.stderr.toString()).toBe("");
  expect(fish.stdout.toString()).toBe(node.stdout.toString());
  expect(fish.stdout.toString().length).toBeGreaterThan(0);
  return [fishDir, nodeDir] as const;
}

// Text that deflates in several blocks, with long and short matches.
function large(): Buffer {
  const letters = Array.from({ length: 200_000 }, (_, i) => String.fromCharCode(97 + ((i * i * 7 + i) % 26)) + (i % 13 === 0 ? " " : "")).join("");
  return Buffer.from(letters + readFileSync(join(import.meta.dir, "..", "src", "check.ts"), "utf8"));
}

test("small inputs compress to node's bytes at every level, and decompress", () => {
  compare("small", `
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
  console.log(show(gzipSync("x", { level: constants.Z_BEST_COMPRESSION })), show(gzipSync("x", {})));`);
});

test("a large input round-trips with node both ways", () => {
  const big = large();
  const setup = (dir: string) => {
    writeFileSync(join(dir, "big.txt"), big);
    writeFileSync(join(dir, "node.gz"), gzipSync(big));
    writeFileSync(join(dir, "node.z"), deflateSync(big, { level: 1 }));
    writeFileSync(join(dir, "node.raw"), deflateRawSync(big, { level: 9 }));
  };
  const [fishDir] = compare("large", `
  const big = readFileSync("big.txt");
  const back = [gunzipSync(readFileSync("node.gz")), inflateSync(readFileSync("node.z")), inflateRawSync(readFileSync("node.raw")), unzipSync(readFileSync("node.gz")), unzipSync(readFileSync("node.z"))];
  for (const b of back) console.log(b.length, same(b, big));
  writeFileSync("out.gz", gzipSync(big.clone()));
  writeFileSync("out.z", deflateSync(big.clone(), { level: 1 }));
  writeFileSync("out.raw", deflateRawSync(big.clone(), { level: 9 }));
  writeFileSync("out0.gz", gzipSync(big, { level: 0 }));`, setup);
  const read = (f: string) => readFileSync(join(fishDir, f));
  expect(gunzipSync(read("out.gz")).equals(big)).toBe(true);
  expect(inflateSync(read("out.z")).equals(big)).toBe(true);
  expect(inflateRawSync(read("out.raw")).equals(big)).toBe(true);
  expect(gunzipSync(read("out0.gz")).equals(big)).toBe(true);
});

test("corrupt input fails with node's message, errno and code", () => {
  compare("corrupt", `
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
  }`);
});

test("a level out of range is node's range error, for every call", () => {
  compare("level", `
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
  }`);
});

test("zlib is compiled and linked into a program only when it calls the module", () => {
  const session = cachedSession();
  const program = (name: string, src: string) => {
    writeFileSync(join(tmp, name), src);
    return compile(session, src, join(tmp, name));
  };
  const using = program("using.fsh", `import { gzipSync, ZlibError } from "node:zlib";\nfunction main(): void throws ZlibError { console.log(gzipSync("x").length); }\n`);
  const plain = program("plain.fsh", `function main() { console.log(new TextEncoder().encode("x").length); }\n`);
  expect(runtimeLinks(using, HOST_TARGET)).toContain("-lz");
  expect(runtimeUnits(using, false).map((u) => u.name)).toContain("zlib");
  expect(runtimeLinks(plain, HOST_TARGET)).not.toContain("-lz");
  expect(runtimeUnits(plain, false).map((u) => u.name)).not.toContain("zlib");
});
