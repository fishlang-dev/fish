// The same body built by Fish and run by node, output compared.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompileError, formatError } from "../../src/diag.fsh";
import { build } from "../../src/main.fsh";
import { cachedSession } from "../../src/stdcache.fsh";
import { ranFor, reference, same } from "./support.fsh";

// A seeded generator, so a failure names values that reproduce.
function values(seed: i64, count: usize): bigint[] {
  let state = seed;
  const next = (): i64 => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state;
  };
  let out: bigint[] = [0n, 1n, -1n, 4294967295n, 4294967296n, -4294967296n];
  while (out.length < count) {
    const bits = 1 + (next() % 300);
    let v = 0n;
    for (let b = 0; b < bits; b += 15) v = (v << 15n) | BigInt(next() % 32768);
    v &= (1n << BigInt(bits)) - 1n;
    out.push(next() % 2 === 0 ? v : -v);
  }
  return out;
}

function text(bytes: Ref<u8[]>): string {
  return new TextDecoder().decode(bytes);
}

function compare(name: string, body: string): void {
  let dir = "";
  try {
    dir = mkdtempSync(join(tmpdir(), "fish-bigint-"));
    const program = join(dir, `${name}.fsh`);
    const src = `function main(): void {${body}\n}\n`;
    writeFileSync(program, src);
    const out = join(dir, name);
    let warnings: string[] = [];
    try {
      for (const w of build(cachedSession(), program, out)) warnings.push(formatError(w, program, src, "warning"));
    } catch (e) {
      if (e instanceof CompileError) assert(false, formatError(e, program, src));
      else assert(false, e.message);
    }
    same(warnings.join("\n"), "", "the build's warnings");
    const fish = spawnSync("env", ["FISH_LEAKS=1", out]);
    const script = join(dir, `${name}.ts`);
    writeFileSync(script, body);
    const node = reference(`bigint-${name}`, body, () => ranFor("node", [script]));
    same(node.stderr, "", "node's stderr");
    same(text(fish.stderr), "", "the program's stderr");
    same(text(fish.stdout), node.stdout, "the output");
  } catch (e) {
    assert(false, e.message);
  }
  try {
    if (dir !== "") rmSync(dir, { recursive: true, force: true });
  } catch (_e) {}
}

test("bigint arithmetic, bitwise operators, shifts and comparisons give node's results", () => {
  const xs = values(7, 24).map((v) => `${v}n`).join(", ");
  compare("table", `
  const xs: bigint[] = [${xs}];
  for (const a of xs) {
    for (const b of xs) {
      console.log(a + b, a - b, a * b, a & b, a | b, a ^ b, a < b, a <= b, a === b, a !== b);
      if (b !== 0n) console.log(a / b, a % b);
    }
    console.log(-a, ~a, a ** 3n, a << 37n, a >> 37n, a >> 1n, a << 0n, a >> 400n, a >> -3n);
  }`);
}, { timeout: 60_000 });
