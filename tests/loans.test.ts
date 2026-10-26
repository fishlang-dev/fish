import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each test builds a program with clang, which can take past bun's 5 seconds on a busy CI runner.
setDefaultTimeout(30_000);

// The borrow checker keys each loan by where it is made. Keys derived from offsets must never
// meet: a `for...of` loop far into a file once took the key of a closure's loan made near its
// start, losing the closure's borrow. Each program puts the loop where that happened.
const tmp = mkdtempSync(join(tmpdir(), "fish-loans-"));

const HEAD = `class P { n: i64; constructor(n: i64) { this.n = n; } }
function main() {
  let xs = [new P(1)];
  const ys = [new P(0)];
`;
const LOOP = `for (const y of ys) { const r: Ref<P> = xs[0]; g(); console.log(r.n, y.n); }
}
`;

// The closure is made at `made`; the loop starts at `made * 512 + 256`.
function placed(before: string, made: number): string {
  const at = made * 512 + 256;
  return `${before}//${"x".repeat(at - before.length - 3)}\n${LOOP}`;
}

function refused(name: string, src: string) {
  const file = join(tmp, `${name}.fsh`);
  writeFileSync(file, src);
  const built = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", file, "-o", join(tmp, name)]);
  expect(built.stderr.toString()).toContain("cannot use 'xs[0]' while 'g' borrows 'xs' mutably and is used later");
}

test("a loop far into a file keeps a nested function's value borrowing", () => {
  const before = `${HEAD}  function reset(): void { xs = [new P(5)]; }\n  const g = `;
  refused("value", placed(`${before}reset;\n`, before.length));
});

test("a loop far into a file keeps an arrow borrowing", () => {
  const before = `${HEAD}  const g = (): void => { `;
  refused("arrow", placed(`${before}xs = [new P(5)]; };\n`, before.length));
});
