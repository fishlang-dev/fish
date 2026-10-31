import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile } from "../src/main.ts";
import { newSession } from "../src/compilation.ts";

// `fishc build -g`: DWARF line tables mapping the program's instructions to `.fsh` lines.
setDefaultTimeout(120_000);

const MAIN = join(import.meta.dir, "..", "src", "main.ts");
const session = newSession();
const root = mkdtempSync(join(tmpdir(), "fish-debuginfo-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const PROGRAM = `function add(a: i64, b: i64): i64 {
  return a + b;
}

function main() {
  const x = add(1, 2);
  console.log(x);
}
`;

// Writes `files` into a directory of its own, the first being the entry, and gives its path.
function place(name: string, files: Record<string, string>): string {
  const dir = join(root, name);
  mkdirSync(dir);
  for (const [file, src] of Object.entries(files)) writeFileSync(join(dir, file), src);
  return join(dir, Object.keys(files)[0]!);
}

// The `DILocation` line of the instruction in `ir` containing `pattern`.
function lineOf(ir: string, pattern: string): number {
  const at = ir.split("\n").find((l) => l.includes(pattern) && l.includes("!dbg"))!;
  const id = / !dbg (!\d+)$/.exec(at)![1]!;
  return Number(new RegExp(`^${id} = !DILocation\\(line: (\\d+),`, "m").exec(ir)![1]);
}

function fishc(cwd: string, args: string[], env: Record<string, string> = {}) {
  const run = Bun.spawnSync(["bun", MAIN, ...args], { cwd, env: { ...process.env, ...env } });
  return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString() };
}

test("-g gives each of the program's functions a subprogram, and each call its .fsh line", () => {
  const file = place("lines", { "main.fsh": PROGRAM });
  const ir = compile(session, PROGRAM, file, false, "unwind", false, false, true);
  expect(ir).toContain("emissionKind: LineTablesOnly");
  expect(ir).toMatch(/!DIFile\(filename: "main\.fsh", directory: "[^"]*lines"\)/);
  expect(ir).toMatch(/!DISubprogram\(name: "add", linkageName: "fsh\.add", [^)]*line: 1,/);
  expect(ir).toMatch(/!DISubprogram\(name: "main", linkageName: "fsh\.main", [^)]*line: 5,/);
  expect(lineOf(ir, 'call i64 @"fsh.add"')).toBe(6);
  expect(lineOf(ir, "@llvm.sadd.with.overflow.i64")).toBe(2);
  expect(ir).not.toContain(";fsh.");
});

test("without -g the IR has no debug metadata", () => {
  const ir = compile(session, PROGRAM, place("plain", { "main.fsh": PROGRAM }), false, "unwind");
  expect(ir).not.toContain("!dbg");
  expect(ir).not.toContain(";fsh.");
});

test("a release -g build marks its subprograms optimized", () => {
  const ir = compile(session, PROGRAM, place("optimized", { "main.fsh": PROGRAM }), true, "unwind", false, false, true);
  expect(ir).toContain("isOptimized: true");
  expect(ir).toContain("DISPFlagDefinition | DISPFlagOptimized");
});

test("a function from an imported file is described in that file", () => {
  const file = place("files", {
    "main.fsh": `import { twice } from "./util.fsh";\n\nfunction main() {\n  console.log(twice(4));\n}\n`,
    "util.fsh": `export function twice(n: i64): i64 {\n\n  return n * 2;\n}\n`,
  });
  const ir = compile(session, readFileSync(file, "utf8"), file, false, "unwind", false, false, true);
  const util = /^(!\d+) = !DIFile\(filename: "util\.fsh"/m.exec(ir)![1]!;
  expect(ir).toMatch(new RegExp(`!DISubprogram\\(name: "twice", [^)]*file: ${util}, line: 1,`));
  expect(lineOf(ir, "@llvm.smul.with.overflow.i64")).toBe(3);
});
