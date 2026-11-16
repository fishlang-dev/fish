// Ports tests/loans.test.ts. The borrow checker keys each loan by where it is made. Keys derived
// from offsets must never meet: a `for...of` loop far into a file once took the key of a closure's
// loan made near its start, losing the closure's borrow. Each program puts the loop where that
// happened.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompileError, formatError } from "../compiler/diag.fsh";
import { build } from "../compiler/main.fsh";
import { cachedSession } from "../compiler/stdcache.fsh";

function head(): string {
  return `class P { n: i64; constructor(n: i64) { this.n = n; } }
function main() {
  let xs = [new P(1)];
  const ys = [new P(0)];
`;
}

function loop(): string {
  return `for (const y of ys) { const r: Ref<P> = xs[0]; g(); console.log(r.n, y.n); }
}
`;
}

// The closure is made at `made`; the loop starts at `made * 512 + 256`.
function placed(before: string, made: usize): string {
  const at = made * 512 + 256;
  return `${before}//${"x".repeat(at - before.length - 3)}\n${loop()}`;
}

function refused(name: string, src: string): void {
  let dir = "";
  let shown = "";
  try {
    dir = mkdtempSync(join(tmpdir(), "fish-loans-"));
    const file = join(dir, `${name}.fsh`);
    writeFileSync(file, src);
    build(cachedSession(), file, join(dir, name));
  } catch (e) {
    if (e instanceof CompileError) shown = formatError(e, `${name}.fsh`, src);
    else shown = e.message;
  }
  try {
    if (dir !== "") rmSync(dir, { recursive: true, force: true });
  } catch (_e) {}
  assert(shown.includes("cannot use 'xs[0]' while 'g' borrows 'xs' mutably and is used later"), `${name}: expected the borrow error, got: ${shown === "" ? "a build" : shown}`);
}

test("a loop far into a file keeps a nested function's value borrowing", () => {
  const before = `${head()}  function reset(): void { xs = [new P(5)]; }\n  const g = `;
  refused("value", placed(`${before}reset;\n`, before.length));
});

test("a loop far into a file keeps an arrow borrowing", () => {
  const before = `${head()}  const g = (): void => { `;
  refused("arrow", placed(`${before}xs = [new P(5)]; };\n`, before.length));
});
