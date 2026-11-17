// What the ported tests share: reading files, which fails the test rather than throwing, running
// the native fishc, asking Prettier, the formatter's reference, how it formats, and reading the
// flags the native fishc compiles the runtime with.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The repository's root.
export function root(): string {
  return join(import.meta.dir, "..", "..");
}

export function read(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    assert(false, `can't read ${path}: ${e.message}`);
    return "";
  }
}

// The fishc the CLI tests run: FISHC, else `fishc` on PATH, as tests/run.fsh picks its compiler.
export function fishcPath(): string {
  return process.env.FISHC ?? "fishc";
}

// What a fishc run gave: its exit code, -1 when a signal ended it, and its output.
export type Ran = { code: i64; out: string; err: string };

// Runs fishc with `args` in `cwd`, with `stdin` piped in when given.
export function fishc(cwd: string, args: string[], stdin?: string): Ran {
  const run = stdin === undefined ? spawnSync(fishcPath(), args, { cwd }) : spawnSync(fishcPath(), args, { cwd, input: stdin });
  const failed = run.error;
  if (failed !== null) assert(false, `can't run ${fishcPath()}: ${failed.message}`);
  const decoder = new TextDecoder();
  return { code: run.status ?? -1, out: decoder.decode(run.stdout), err: decoder.decode(run.stderr) };
}

// Fails the test with both runs shown when `got` isn't the exit code and output wanted.
export function ran(got: Ref<Ran>, code: i64, out: string, err: string, what: string): void {
  assert(got.code === code && got.out === out && got.err === err, `${what}:\n--- expected\ncode ${code}\nstdout:\n${out}\nstderr:\n${err}\n--- got\ncode ${got.code}\nstdout:\n${got.out}\nstderr:\n${got.err}`);
}

// Fails the test with both values shown when they differ.
export function same(got: string, want: string, what: string): void {
  assert(got === want, `${what}:\n--- expected\n${want}\n--- got\n${got}`);
}

// Bytes as UTF-8 text.
export function text(bytes: Ref<u8[]>): string {
  return new TextDecoder().decode(bytes);
}

// A fresh directory under the system's temporary one, by its real path.
export function scratch(prefix: string): string {
  try {
    return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  } catch (e) {
    assert(false, `can't make a directory: ${e.message}`);
    return "";
  }
}

// Removes a directory `scratch` made.
export function removed(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (_e) {}
}

// Builds `source` as the program `name` in `dir` with the native fishc, giving the executable's
// path and failing the test when the build prints anything.
export function built(dir: string, name: string, source: string): string {
  const program = join(dir, `${name}.fsh`);
  try {
    writeFileSync(program, source);
  } catch (e) {
    assert(false, `can't write ${program}: ${e.message}`);
  }
  const out = join(dir, name);
  const run = fishc(dir, ["build", program, "-o", out]);
  same(run.err, "", `building ${name}`);
  assert(run.code === 0, `building ${name} exited with ${run.code}`);
  return out;
}

// Bun's script printing, as a JSON array, how Prettier formats each input of the JSON array in a
// file: read with `parser`, or for "doc", each input a JSON `[width, doc]` of the formatter's
// documents, laid out by Prettier's own document printer.
function prettierScript(): string {
  return `import { readFileSync } from "node:fs";
const [parser, file, root] = process.argv.slice(2);
const inputs = JSON.parse(readFileSync(file, "utf8"));
const prettier = await import(Bun.resolveSync("prettier", root));
const { builders: b, printer } = await import(Bun.resolveSync("prettier/doc", root));
function theirs(d, ids) {
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => theirs(x, ids));
  const id = (name) => (ids.has(name) ? ids.get(name) : ids.set(name, Symbol(name)).get(name));
  switch (d.kind) {
    case "group":
      return d.expandedStates !== null
        ? b.conditionalGroup(d.expandedStates.map((s) => theirs(s, ids)), { shouldBreak: d.break })
        : b.group(theirs(d.contents, ids), { shouldBreak: d.break, id: d.id !== null ? id(d.id) : undefined });
    case "indent": return b.indent(theirs(d.contents, ids));
    case "align": return b.align(Number(d.n), theirs(d.contents, ids));
    case "line": return d.hard ? (d.literal ? b.literallineWithoutBreakParent : b.hardlineWithoutBreakParent) : d.soft ? b.softline : b.line;
    case "ifBreak": return b.ifBreak(theirs(d.breakContents, ids), theirs(d.flatContents, ids), { groupId: d.groupId !== null ? id(d.groupId) : undefined });
    case "indentIfBreak": return b.indentIfBreak(theirs(d.contents, ids), { groupId: id(d.groupId), negate: d.negate });
    case "fill": return b.fill(d.parts.map((p) => theirs(p, ids)));
    case "breakParent": return b.breakParent;
    case "lineSuffix": return b.lineSuffix(theirs(d.contents, ids));
    case "lineSuffixBoundary": return b.lineSuffixBoundary;
    case "label": return b.label(d.label, theirs(d.contents, ids));
    case "trim": return b.trim;
  }
  throw new Error("unknown document kind " + d.kind);
}
const out = [];
for (const input of inputs) {
  if (parser !== "doc") {
    out.push(await prettier.format(input, { parser }));
    continue;
  }
  const [width, doc] = JSON.parse(input);
  out.push(printer.printDocToString(theirs(doc, new Map()), { printWidth: width, tabWidth: 2, useTabs: false }).formatted);
}
console.log(JSON.stringify(out));
`;
}

// How Prettier formats each input, asked of the `prettier` package found from the repository's
// root through a Bun child process, all inputs at once to start Bun once. Prettier is the reference
// the formatter is held to, never part of a build. Without it the test fails.
export function prettier(parser: string, inputs: Ref<string[]>): string[] {
  let dir = "";
  try {
    dir = mkdtempSync(join(tmpdir(), "fishc-prettier-"));
    const script = join(dir, "prettier.mjs");
    const file = join(dir, "inputs.json");
    writeFileSync(script, prettierScript());
    writeFileSync(file, `[${inputs.map((s) => JSON.stringify(s)).join(",")}]`);
    const run = spawnSync("bun", [script, parser, file, root()]);
    const decoder = new TextDecoder();
    assert(run.status === 0, `prettier failed: ${decoder.decode(run.stderr)}`);
    const out = JSON.parse<string[]>(decoder.decode(run.stdout));
    rmSync(dir, { recursive: true, force: true });
    return out;
  } catch (e) {
    if (dir !== "") {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch (_e) {}
    }
    assert(false, `can't ask prettier: ${e.message}`);
    return [];
  }
}

// A TCP port on 127.0.0.1 that was free a moment ago, asked of a Node child process, for a server
// that can't report the port it bound.
export function freePort(): i64 {
  const script = `const s = require("node:net").createServer().listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close(); });`;
  const run = spawnSync("node", ["-e", script]);
  const port = parseInt(text(run.stdout).trim());
  assert(port !== null, `no free port: ${text(run.stderr)}`);
  return port;
}

// The arguments the native fishc gives clang to compile the runtime, before its output, for a build
// of `file` with `flags` and a cache of its own under `root`, and the name of the object it was to
// write, its hash left out. A clang on PATH logs each runtime compile and fails it, so nothing is
// compiled and the build stops there.
export function runtimeArgs(root: string, file: string, flags: string[]): [string, string] {
  const bin = join(root, "shim");
  const log = join(root, "clang.log");
  try {
    writeFileSync(log, "");
    mkdirSync(bin, { recursive: true });
    const clang = Bun.which("clang");
    assert(clang !== null, "no clang on PATH");
    writeFileSync(join(bin, "clang"), `#!/bin/sh\ncase " $* " in\n  *" -x c - "*" -c -o "*) echo "$*" >> ${JSON.stringify(log)}; exit 1 ;;\nesac\nexec ${JSON.stringify(clang!)} "$@"\n`);
    chmodSync(join(bin, "clang"), 0o755);
  } catch (e) {
    assert(false, `can't make the clang shim: ${e.message}`);
  }
  const cache = join(root, `cache-${flags.join("")}`);
  spawnSync("env", [`FISH_CACHE_DIR=${cache}`, `PATH=${bin}:${process.env.PATH ?? ""}`, fishcPath(), "build", file, "-o", join(root, "main"), ...flags]);
  const lines = read(log).split("\n").filter((l) => l !== "");
  assert(lines.length === 1, `the runtime compiles logged:\n${lines.join("\n")}`);
  const at = lines[0].indexOf(" -c -o ");
  const object = lines[0].slice((at + 7) as i64).split("/").at(-1)!;
  const m = /^(.*)-[0-9a-f]{16}\.o/.exec(object);
  assert(m !== null, `the runtime's object: ${object}`);
  const name = m![1];
  return [lines[0].slice(0, at as i64), name];
}
