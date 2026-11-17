// Ports tests/debuginfo.test.ts: `fishc build -g`, DWARF line tables mapping the program's
// instructions to `.fsh` lines, each IR read from the native fishc's `--emit-llvm`.
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fishc, fishcPath, ran, removed, same, scratch, text, type Ran } from "./support.fsh";

function program(): string {
  return `function add(a: i64, b: i64): i64 {
  return a + b;
}

function main() {
  const x = add(1, 2);
  console.log(x);
}
`;
}

// Writes `files` into the directory `name` under `root`, the first being the entry, and gives its
// path.
function place(root: string, name: string, files: Ref<[string, string][]>): string {
  const dir = join(root, name);
  try {
    mkdirSync(dir);
    for (const [file, src] of files) writeFileSync(join(dir, file), src);
  } catch (e) {
    assert(false, `can't write ${dir}: ${e.message}`);
  }
  return join(dir, files[0][0]);
}

// The IR the native fishc emits for `file` with `flags`.
function emitted(file: string, flags: string[]): string {
  const dir = join(file, "..");
  const run = fishc(dir, ["build", file, "--emit-llvm", ...flags]);
  same(run.err, "", `emitting ${file}`);
  assert(run.code === 0, `emitting ${file} exited with ${run.code}`);
  return run.out;
}

// The `DILocation` line of the instruction in `ir` containing `pattern`.
function lineOf(ir: string, pattern: string): i64 {
  const lines = ir.split("\n");
  const at = lines.find((l) => l.includes(pattern) && l.includes("!dbg"));
  assert(at !== undefined, `no instruction with ${pattern} and !dbg`);
  const m = / !dbg (!\d+)$/.exec(at!);
  assert(m !== null, `no !dbg at the end of ${at!}`);
  const id = m![1];
  const head = `${id} = !DILocation(line: `;
  const loc = lines.find((l) => l.startsWith(head));
  assert(loc !== undefined, `no ${head}`);
  const rest = loc!.slice(head.length as i64);
  const n = parseInt(rest.slice(0, rest.indexOf(",")));
  assert(n !== null, `no line in ${loc!}`);
  return n!;
}

test("-g gives each of the program's functions a subprogram, and each call its .fsh line", () => {
  const root = scratch("fish-debuginfo-");
  const file = place(root, "lines", [["main.fsh", program()]]);
  const ir = emitted(file, ["-g"]);
  assert(ir.includes("emissionKind: LineTablesOnly"), "no LineTablesOnly");
  assert(/!DIFile\(filename: "main\.fsh", directory: "[^"]*lines"\)/.test(ir), "no DIFile for main.fsh");
  assert(/!DISubprogram\(name: "add", linkageName: "fsh\.add", [^)]*line: 1,/.test(ir), "no subprogram for add");
  assert(/!DISubprogram\(name: "main", linkageName: "fsh\.main", [^)]*line: 5,/.test(ir), "no subprogram for main");
  assert(lineOf(ir, 'call i64 @"fsh.add"') === 6, "the call's line");
  assert(lineOf(ir, "@llvm.sadd.with.overflow.i64") === 2, "the add's line");
  assert(!ir.includes(";fsh."), "a ;fsh. comment");
  removed(root);
}, { timeout: 120_000 });

test("without -g the IR has no debug metadata", () => {
  const root = scratch("fish-debuginfo-");
  const ir = emitted(place(root, "plain", [["main.fsh", program()]]), []);
  assert(!ir.includes("!dbg"), "a !dbg");
  assert(!ir.includes(";fsh."), "a ;fsh. comment");
  removed(root);
}, { timeout: 120_000 });

test("a release -g build marks its subprograms optimized", () => {
  const root = scratch("fish-debuginfo-");
  const ir = emitted(place(root, "optimized", [["main.fsh", program()]]), ["--release", "-g"]);
  assert(ir.includes("isOptimized: true"), "no isOptimized");
  assert(ir.includes("DISPFlagDefinition | DISPFlagOptimized"), "no DISPFlagOptimized");
  removed(root);
}, { timeout: 120_000 });

test("a function from an imported file is described in that file", () => {
  const root = scratch("fish-debuginfo-");
  const file = place(root, "files", [
    ["main.fsh", `import { twice } from "./util.fsh";\n\nfunction main() {\n  console.log(twice(4));\n}\n`],
    ["util.fsh", `export function twice(n: i64): i64 {\n\n  return n * 2;\n}\n`],
  ]);
  const ir = emitted(file, ["-g"]);
  const m = /^(!\d+) = !DIFile\(filename: "util\.fsh"/m.exec(ir);
  assert(m !== null, "no DIFile for util.fsh");
  const util = m![1];
  const head = `!DISubprogram(name: "twice", `;
  const at = ir.indexOf(head);
  assert(at >= 0, "no subprogram for twice");
  const fields = ir.slice(at, ir.indexOf(")", at));
  assert(fields.includes(`file: ${util}, line: 1,`), `twice's subprogram: ${fields}`);
  assert(lineOf(ir, "@llvm.smul.with.overflow.i64") === 3, "the multiply's line");
  removed(root);
}, { timeout: 120_000 });

function stdProgram(): string {
  return `function main() {
  const words = ["a", "bb", "ccc"].map((w) => w.toUpperCase());
  let m = new Map<string, usize>();
  for (const w of words) m.set(w, w.length);
  console.log(words.join(","), m.get("BB"));
}
`;
}

// Runs the native fishc with `args` in `cwd` and the cache at `cache`.
function cachedFishc(cwd: string, cache: string, args: string[]): Ran {
  const run = spawnSync("env", [`FISH_CACHE_DIR=${cache}`, fishcPath(), ...args], { cwd });
  return { code: run.status ?? -1, out: text(run.stdout), err: text(run.stderr) };
}

function stdObjects(cache: string): string[] {
  try {
    let found = readdirSync(join(cache, "objects")).filter((f) => f.startsWith("std-"));
    found.sort();
    return found;
  } catch (e) {
    assert(false, `can't list ${cache}: ${e.message}`);
    return [];
  }
}

test("-g dev and release builds run as plain ones do, and share std's cached object", () => {
  const root = scratch("fish-debuginfo-");
  const file = place(root, "binaries", [["main.fsh", stdProgram()]]);
  const cache = join(root, "cache");
  const dir = join(root, "binaries");
  const built = (out: string, flags: string[]) => {
    ran(cachedFishc(dir, cache, ["build", file, "-o", out, ...flags]), 0, "", "", `building ${out}`);
    return text(spawnSync(join(dir, out), []).stdout);
  };
  same(built("plain", []), "A,BB,CCC 2\n", "the plain build");
  const std = stdObjects(cache);
  assert(std.length === 1, `std's objects: ${JSON.stringify(std)}`);
  same(built("debug", ["-g"]), "A,BB,CCC 2\n", "the -g build");
  same(built("release", ["-g", "--release"]), "A,BB,CCC 2\n", "the release -g build");
  assert(stdObjects(cache) === std, `std's objects now: ${JSON.stringify(stdObjects(cache))}`);
  removed(root);
}, { timeout: 120_000 });

test("fishc run -g runs the program", () => {
  const root = scratch("fish-debuginfo-");
  const file = place(root, "run", [["main.fsh", program()]]);
  ran(fishc(join(root, "run"), ["run", file, "-g"]), 0, "3\n", "", "fishc run -g");
  removed(root);
}, { timeout: 120_000 });

test("lldb stops at a breakpoint on a .fsh line", () => {
  if (Bun.which("lldb") === null) {
    console.log("skipped: no lldb on PATH");
    return;
  }
  const root = scratch("fish-debuginfo-");
  const file = place(root, "lldb", [["main.fsh", program()]]);
  const dir = join(root, "lldb");
  assert(fishc(dir, ["build", file, "-g", "-o", "prog"]).code === 0, "the build failed");
  const session = spawnSync("lldb", ["-b", "-o", "b main.fsh:6", "-o", "run", "-o", "bt", "-o", "kill", "prog"], { cwd: dir });
  const out = text(session.stdout);
  assert(out.includes("Breakpoint 1: where = prog`main + "), `lldb said:\n${out}`);
  assert(/frame #0: .* prog`main at main\.fsh:6:13/.test(out), `lldb said:\n${out}`);
  removed(root);
}, { timeout: 120_000 });

// A timed build compiles and links in two clang calls, which on macOS must still leave a .dSYM.
test("lldb resolves a .fsh breakpoint in a build timed with --timings", () => {
  if (Bun.which("lldb") === null) {
    console.log("skipped: no lldb on PATH");
    return;
  }
  const root = scratch("fish-debuginfo-");
  const file = place(root, "timed", [["main.fsh", program()]]);
  const dir = join(root, "timed");
  assert(fishc(dir, ["build", file, "-g", "--timings", "-o", "prog"]).code === 0, "the build failed");
  if (process.platform === "darwin") {
    try {
      assert(readdirSync(dir).includes("prog.dSYM"), "no prog.dSYM");
    } catch (e) {
      assert(false, e.message);
    }
  }
  const session = spawnSync("lldb", ["-b", "-o", "b main.fsh:6", "prog"], { cwd: dir });
  assert(text(session.stdout).includes("Breakpoint 1: where = prog`main + "), `lldb said:\n${text(session.stdout)}`);
  removed(root);
});
