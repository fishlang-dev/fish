import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each test builds a program with clang, which can take past bun's 5 seconds on a busy runner.
setDefaultTimeout(60_000);

const tmp = mkdtempSync(join(tmpdir(), "fish-bigint-"));

// A seeded generator, so a failure names values that reproduce.
function values(seed: number, count: number): bigint[] {
  let state = seed;
  const next = () => (state = (state * 1103515245 + 12345) % 2147483648);
  const out: bigint[] = [0n, 1n, -1n, 4294967295n, 4294967296n, -4294967296n];
  while (out.length < count) {
    const bits = 1 + (next() % 300);
    let v = 0n;
    for (let b = 0; b < bits; b += 15) v = (v << 15n) | BigInt(next() % 32768);
    v &= (1n << BigInt(bits)) - 1n;
    out.push(next() % 2 === 0 ? v : -v);
  }
  return out;
}

// The same body built by Fish and run by node, output compared.
function compare(name: string, body: string) {
  const program = join(tmp, `${name}.fsh`);
  writeFileSync(program, `function main(): void {${body}\n}\n`);
  const out = join(tmp, name);
  const built = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out]);
  expect(built.stderr.toString()).toBe("");
  const fish = Bun.spawnSync([out], { env: { ...process.env, FISH_LEAKS: "1" } });
  const script = join(tmp, `${name}.ts`);
  writeFileSync(script, body);
  const node = Bun.spawnSync(["node", script]);
  expect(node.stderr.toString()).toBe("");
  expect(fish.stderr.toString()).toBe("");
  expect(fish.stdout.toString()).toBe(node.stdout.toString());
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
});
