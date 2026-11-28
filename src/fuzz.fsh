import { relative } from "node:path";
import type { Compilation } from "./compilation.fsh";
import { CompileError } from "./diag.fsh";
import { renameIn, type Loaded, type Module } from "./modules.fsh";
import { nextId, respanFunc, type Ids } from "./nodes.fsh";
import { parse, type Expr, type Func, type Param, type Span, type Stmt, type TypeNode } from "./parser.fsh";

// Top-level `fuzz("name", (data) => { ... })` blocks: left out of a normal build, lifted into
// functions of their own file for `fishc fuzz`, `fishc check`, and the language server, and driven
// by a generated `LLVMFuzzerTestOneInput` harness under libFuzzer.

type Body = Extract<Expr, { kind: "arrow" | "function" }>;

export type FuzzTarget = { name: string; module: { file: string; path: string }; index: usize };

const SHAPE = `a fuzz target is written as 'fuzz("name", (data) => { ... })' at the top level of a file, its name a string literal and its body taking one 'u8[]' parameter`;

type Found = { name: string; start: usize; end: usize };

function isByteSlice(t: Ref<TypeNode>): boolean {
  if (t.kind === "array") return t.element.kind === "ref" && t.element.name === "u8" && t.element.args.length === 0;
  if (t.kind === "ref") return t.name === "Uint8Array" && t.args.length === 0;
  return false;
}

function isBytesType(t: Ref<TypeNode>): boolean {
  if (isByteSlice(t)) return true;
  return t.kind === "ref" && t.name === "Ref" && t.args.length === 1 && isByteSlice(t.args[0]!);
}

// The fuzz target a top-level statement is, or undefined when it isn't a `fuzz(...)` call.
/** @throws {CompileError} */
export function fuzzOf(s: Ref<Stmt>): Found | undefined {
  if (s.kind !== "expr" || s.expr.kind !== "call" || s.expr.callee.kind !== "ident" || s.expr.callee.name !== "fuzz") return undefined;
  const args: Ref<Expr[]> = s.expr.args;
  if (args.length !== 2 || s.expr.typeArgs.length > 0 || s.expr.optional || args[0]!.kind !== "string") throw new CompileError("E1106", SHAPE, s.expr.start, s.expr.end);
  const name: Ref<Expr> = args[0]!;
  const body: Ref<Expr> = args[1]!;
  if (name.kind !== "string") return undefined;
  if (body.kind !== "arrow" && body.kind !== "function") throw new CompileError("E1106", SHAPE, s.expr.start, s.expr.end);
  if (body.async) throw new CompileError("E1106", "a fuzz target can't be async; libFuzzer runs each input synchronously", body.start, body.end);
  if (body.kind === "function" && body.generator) throw new CompileError("E1106", SHAPE, body.start, body.end);
  if (body.typeParams.length > 0 || body.params.length !== 1) throw new CompileError("E1106", SHAPE, body.start, body.end);
  const param: Ref<Param> = body.params[0]!;
  if (param.pattern.kind !== "ident" || param.rest || param.optional || param.default !== undefined || param.comptime) throw new CompileError("E1106", SHAPE, param.start, param.end);
  if (param.type !== undefined && !isBytesType(param.type!)) throw new CompileError("E1106", "a fuzz target's parameter must be 'u8[]', 'Uint8Array', or a 'Ref' to one", param.start, param.end);
  if (/[\n\r]/.test(name.value)) throw new CompileError("E1106", "a fuzz target's name is one line, so it can't hold a line break", name.start, name.end);
  return { name: name.value, start: name.start, end: name.end };
}

// Leaves every file's fuzz targets out, as a normal build does before checking.
/** @throws {CompileError} */
export function stripFuzz(loaded: Mut<Loaded>) {
  for (let at: usize = 0; at < loaded.modules.length; at++) {
    const m: Mut<Module> = loaded.modules[at]!;
    let targets: boolean[] = [];
    for (const s of m.statements) targets.push(fuzzOf(s) !== undefined);
    let kept: Stmt[] = [];
    let i: usize = 0;
    while (m.statements.length > 0) {
      const s = m.statements.shift()!;
      if (!targets[i]!) kept.push(s);
      i++;
    }
    m.statements = kept;
  }
}

// The function a fuzz target is lifted into. Linking renames a qualified name only up to its first
// dot, so the symbol holds none.
export function fuzzSymbol(name: string): string {
  return `fuzz ${JSON.stringify(name).replaceAll(".", "\\u002e")}`;
}

// Turns each fuzz target of the files at `paths`, in that order, into a function of its own file,
// `fuzz "name"`, which no program can write. Names are unique across the files.
/** @throws {CompileError | Error} */
export function liftFuzz(compilation: Mut<Compilation>, modules: Mut<Module[]>, paths: Ref<string[]>): FuzzTarget[] {
  let targets: FuzzTarget[] = [];
  for (const path of paths) {
    const at = modules.findIndex((m) => m.path === path);
    if (at < 0) continue;
    const module: Mut<Module> = modules[at as usize]!;
    let symbols: (string | undefined)[] = [];
    for (const s of module.statements) {
      const found = fuzzOf(s);
      if (found === undefined) {
        symbols.push(undefined);
        continue;
      }
      const name = found.name;
      const twin = targets.find((t) => t.name === name);
      if (twin !== undefined) throw new CompileError("E1106", `there is already a fuzz target named '${name}' in '${twin.module.file}'; give each fuzz target a name of its own`, found.start, found.end);
      targets.push({ name, module: { file: module.file, path: module.path }, index: targets.length });
      const symbol = fuzzSymbol(name);
      compilation.names.madeUp.set(symbol, `the fuzz target '${name}'`);
      symbols.push(symbol);
    }
    let statements: Stmt[] = [];
    let i: usize = 0;
    while (module.statements.length > 0) {
      const s = module.statements.shift()!;
      const symbol = symbols[i];
      i++;
      if (symbol === undefined) statements.push(s);
      else statements.push(liftedFuzz(compilation.ids, symbol, s));
    }
    module.statements = statements;
  }
  return targets;
}

/** @throws {CompileError | Error} */
function liftedFuzz(ids: Mut<Ids>, name: string, s: Stmt): Func {
  const at: Span = { start: s.start, end: s.end };
  let call = s;
  if (call.kind === "expr" && call.expr.kind === "call") {
    const body = call.expr.args.pop();
    if (body !== undefined && (body.kind === "arrow" || body.kind === "function")) return lifted(ids, name, body, at);
  }
  throw new Error("internal error: a fuzz target is no longer a call of 'fuzz'");
}

/** @throws {CompileError | Error} */
function lifted(ids: Mut<Ids>, name: string, body: Body, at: Ref<Span>): Func {
  let parsed = parse("function f(data: u8[]): void throws Error {}", ids);
  const made = parsed.shift();
  if (made === undefined || made.kind !== "function") throw new Error("internal error: a fuzz target's function didn't parse as one");
  let placed = respanFunc(made, at);
  const defaultParam = placed.params.shift()!;
  let b = body;
  if (b.kind === "function") {
    let param = b.params.shift()!;
    if (param.type === undefined) param.type = defaultParam.type;
    return { ...placed, id: nextId(ids), name, params: [param], body: b.body };
  }
  let param = b.params.shift()!;
  if (param.type === undefined) param.type = defaultParam.type;
  let statements: Stmt[] = [];
  if (Array.isArray(b.body)) statements = b.body;
  else {
    const start = b.body.start;
    const end = b.body.end;
    statements = [{ id: nextId(ids), kind: "expr", expr: b.body, start, end }];
  }
  return { ...placed, id: nextId(ids), name, params: [param], body: statements };
}

// The harness's imports and C declarations before the entry point is appended.
export function fuzzHarnessImports(dir: string, files: string[]): string {
  const imports = files.map((f) => {
    const rel = relative(dir, f);
    const spec = rel.startsWith("./") || rel.startsWith("../") ? rel : `./${rel}`;
    return `import ${JSON.stringify(spec)};`;
  });
  return [
    "// @fish-edition native",
    ...imports,
    "declare function abort(): void;",
    "",
  ].join("\n");
}

// The libFuzzer entry point calling `target`: copies libFuzzer's buffer into a fresh owned byte
// array, runs the target, and aborts on any uncaught Error so libFuzzer saves the reproducing
// input. Fish panics abort directly via @fsh_panic_abort = 1.
/** @throws {CompileError} */
export function fuzzHarnessMain(ids: Mut<Ids>, target: Ref<FuzzTarget>, modules: Ref<Module[]>): Stmt[] {
  const placeholder = "__fuzz_target";
  const text = `export function LLVMFuzzerTestOneInput(data: Ptr<u8>, size: usize): i32 {
  let bytes = new Uint8Array(size);
  if (size > 0) {
    unsafe { fsh_rt_bytes_copy(mutPtrOf(bytes[0]), data, size as i64); }
  }
  try {
    ${placeholder}(bytes);
  } catch (e) {
    console.error(\`Error: \${e.message}\`);
    unsafe { abort(); }
  }
  return 0;
}
`;
  let made = parse(text, ids);
  const idx = modules.findIndex((m) => m.path === target.module.path);
  const realName = `${fuzzSymbol(target.name)}-fsh${idx}`;
  renameIn(ids, made, (name) => (name === placeholder ? realName : undefined));
  return made;
}

// Quotes an argument for a printable shell replay hint when it contains whitespace or shell chars.
export function shellQuote(arg: string): string {
  if (arg !== "" && /^[A-Za-z0-9._/@:+-]+$/.test(arg)) return arg;
  return "'" + arg.replaceAll("'", "'\\''") + "'";
}

function hexByte(b: u8): string {
  const digits = "0123456789abcdef";
  const hi = ((b as usize) >> 4) & 15;
  const lo = (b as usize) & 15;
  return digits.slice(hi as i64, (hi + 1) as i64) + digits.slice(lo as i64, (lo + 1) as i64);
}

// Formats the saved crash artifact for the terminal: path, length, hex preview, and UTF-8 preview.
export function formatReproducer(target: Ref<FuzzTarget>, artifactPath: string, sample: Ref<u8[]>, totalBytes: usize, replayHint: string): string {
  const limit: usize = 256;
  const shown = sample.length < limit ? sample.length : limit;
  let hex: string[] = [];
  for (let i: usize = 0; i < shown; i++) hex.push(hexByte(sample[i]!));
  const suffix = totalBytes > shown ? ` ... (${totalBytes - shown} more bytes)` : "";
  const preview = shown === 0 ? `""` : JSON.stringify(new TextDecoder().decode(sample.slice(0, shown as i64)));
  return [
    `FAIL ${target.module.file} > ${target.name}`,
    `  reproducing input: ${artifactPath} (${totalBytes} byte${totalBytes === 1 ? "" : "s"})`,
    `  hex:  ${hex.length === 0 ? "(empty)" : hex.join(" ")}${suffix}`,
    `  text: ${preview}${suffix}`,
    `  replay: ${replayHint}`,
  ].join("\n");
}
