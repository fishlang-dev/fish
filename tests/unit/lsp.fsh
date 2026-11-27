// Checking documents and splitting frames in process, through the compiler's own functions, and
// `fishc lsp` itself as the native fishc. A Fish child's output comes whole once it ends, while the
// server is driven message by message, so each server test builds a Fish driver that starts `fishc
// lsp` behind two named pipes, speaks the protocol to it, and prints what it saw once done: one fact
// per line, a name, a tab and a JSON string. Objects in a fact are written with their keys sorted,
// so the expected JSON below is written that way too.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compiledOf } from "../../src/codegen.fsh";
import { newCompilation } from "../../src/compilation.fsh";
import { CompileError } from "../../src/diag.fsh";
import { type Kept } from "../../src/incremental.fsh";
import { diagnose, frames } from "../../src/lsp.fsh";
import { analyze } from "../../src/main.fsh";
import { load } from "../../src/modules.fsh";
import { cachedSession } from "../../src/mathlib.fsh";
import { built, fishcPath, removed, same, scratch, text } from "./support.fsh";

// A file in the test's directory holding `src`, as an editor's file would be on disk.
function file(dir: string, name: string, src: string): string {
  const path = join(dir, name);
  try {
    writeFileSync(path, src);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
  return path;
}

function made(path: string): void {
  try {
    mkdirSync(path, { recursive: true });
  } catch (e) {
    assert(false, `can't make ${path}: ${e.message}`);
  }
}

test("a file without main is checked as a module", () => {
  const dir = scratch("fishc-lsp-");
  const src = "export class Oops { code: i64 = 1 }\nexport function f(n: i64): i64 throws Oops {\n  if (n < 0) throw new Oops();\n  return n;\n}\n";
  try {
    const { checked } = analyze(cachedSession(), src, file(dir, "module.fsh", src));
    assert(compiledOf(checked).some((i) => i.symbol === "f"), "no instance of f");
  } catch (e) {
    assert(false, e.message);
  }
  removed(dir);
});

// One of the server's checks of the document at `path`, from the last one.
function diagnosed(path: string, text: string, open: Map<string, string>, kept: Kept | undefined): { warnings: usize; checks: usize; kept: Kept | undefined } throws Error {
  try {
    let found = diagnose(cachedSession(), path, text, open, kept);
    const warnings = found.diagnostics.length;
    let checks: usize = 0;
    if (found.kept !== undefined) checks = found.kept!.checked.tables.counts.checks;
    return { warnings, checks, kept: found.kept };
  } catch (e) {
    throw new Error(`the check failed: ${(e as { message: string }).message}`);
  }
}

test("a document checked again from the last check checks nothing again, and after an edit only the body that changed", () => {
  const dir = scratch("fishc-lsp-kept-");
  const lib = "export function twice(n: i64): i64 { return n * 2; }\n";
  const src = 'import { twice } from "./lib.fsh";\n\nfunction main() {\n  console.log(twice(21));\n}\n';
  const libPath = file(dir, "lib.fsh", lib);
  const path = file(dir, "main.fsh", src);
  let open = new Map<string, string>();
  open.set(path, src);
  open.set(libPath, lib);
  let first = diagnosed(path, src, open.clone(), undefined);
  assert(first.warnings === 0, `the first check gave ${first.warnings} diagnostic(s)`);
  assert(first.checks > 0, "the first check checked nothing");
  let second = diagnosed(path, src, open.clone(), first.kept);
  assert(second.checks === first.checks, `the second check checked ${second.checks - first.checks} instances again`);
  // An unsaved edit to the imported file: only that body and what reads it are checked again, and
  // its unused local is reported, though the file on disk still has none.
  let edited = new Map<string, string>();
  edited.set(path, src);
  edited.set(libPath, "export function twice(n: i64): i64 { const spare = n; return n * 2; }\n");
  let third = diagnosed(path, src, edited, second.kept);
  assert(third.checks > second.checks, "the check after an unsaved edit checked nothing again");
  assert(third.checks < second.checks * 2, `the check after an edit checked ${third.checks - second.checks} instances, which is not only what changed`);
  removed(dir);
}, { timeout: 120_000 });

// The source an analysis of `src` is refused at, or what else happened.
function refusedAt(src: string, path: string): string {
  try {
    analyze(cachedSession(), src, path);
    return "(checked)";
  } catch (e) {
    if (e instanceof CompileError) return src.slice(e.start as i64, e.end as i64);
    return `(not a CompileError: ${e.message})`;
  }
}

test("a type error is thrown at its span", () => {
  const dir = scratch("fishc-lsp-");
  const src = "function main() {\n  const n: i64 = true;\n}\n";
  same(refusedAt(src, file(dir, "bad.fsh", src)), "true", "the error's span");
  removed(dir);
});

test("a type error inside a test block is reported, though a build leaves the block out", () => {
  const dir = scratch("fishc-lsp-");
  const src = 'function main() {}\ntest("adds", () => {\n  const n: i64 = "two";\n});\n';
  same(refusedAt(src, file(dir, "tested.fsh", src)), '"two"', "the error's span");
  same(refusedAt('function main() {}\ntest("adds", () => {\n  assert(1 + 1 === 2);\n});\n', file(dir, "passing.fsh", "")), "(checked)", "the passing test block");
  removed(dir);
});

test("imported files are read through the reader given", () => {
  const dir = scratch("fishc-lsp-");
  file(dir, "lib.fsh", "export function two(): i64 { return 2; }\n");
  const src = 'import { three } from "./lib.fsh";\nfunction main() { print(three()); }\n';
  const read = (path: string): string | undefined => (path.endsWith("lib.fsh") ? "export function three(): i64 { return 3; }\n" : "");
  try {
    let compilation = newCompilation(cachedSession());
    const loaded = load(compilation, file(dir, "reader.fsh", src), src, read);
    assert(loaded.sources.some((s) => s.src === "export function three(): i64 { return 3; }\n"), "lib.fsh wasn't read through the reader");
  } catch (e) {
    assert(false, `loading: ${e.message}`);
  }
  try {
    analyze(cachedSession(), src, join(dir, "reader.fsh"), read);
  } catch (e) {
    assert(false, `checking: ${e.message}`);
  }
  removed(dir);
});

function frame(body: string): string {
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

test("frames are split by their byte lengths, and a partial one waits", () => {
  const both = Buffer.from(frame('{"a":"é"}') + frame('{"b":2}') + "Content-Length: 7\r\n\r\n{\"c\"");
  const { bodies, rest } = frames(both);
  assert(bodies === ['{"a":"é"}', '{"b":2}'], `the bodies: ${JSON.stringify(bodies)}`);
  const next = frames(Buffer.concat([rest, Buffer.from(":3}")])).bodies;
  assert(next === ['{"c":3}'], `the bodies after the rest: ${JSON.stringify(next)}`);
});

// What every driver starts with: a running `fishc lsp` and the messages it has sent, the JSON it
// reads them as, and the requests and notifications the tests send.
function prelude(): string {
  return String.raw`import { open, FileHandle } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Subprocess } from "bun";

// A JSON value with its objects' keys sorted, so two runs print it alike.
function canon(v: Ref<Json>): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) {
    let parts: string[] = [];
    for (const x of v) parts.push(canon(x));
    return "[" + parts.join(",") + "]";
  }
  let keys: string[] = [];
  for (const k of v.keys()) keys.push(k);
  keys.sort();
  let parts: string[] = [];
  for (const k of keys) parts.push(JSON.stringify(k) + ":" + canon(v.get(k)!));
  return "{" + parts.join(",") + "}";
}

// The member 'key' of an object, or null for anything else or a key it lacks.
function at(v: Ref<Json>, key: string): Json {
  if (v instanceof Map) {
    const got = v.get(key);
    if (got !== undefined) return got.clone();
  }
  return null;
}

// The element 'i' of an array, or null.
function item(v: Ref<Json>, i: usize): Json {
  if (Array.isArray(v) && i < v.length) return v[i]!.clone();
  return null;
}

// The elements of an array, or none.
function items(v: Ref<Json>): Json[] {
  let out: Json[] = [];
  if (Array.isArray(v)) for (const x of v) out.push(x.clone());
  return out;
}

// A value as a fact prints it: a string as it is, anything else as JSON.
function shown(v: Ref<Json>): string {
  return typeof v === "string" ? v : canon(v);
}

function has(v: Ref<Json>, key: string): boolean {
  return v instanceof Map && v.has(key);
}

function frame(body: string): string {
  return "Content-Length: " + String(new TextEncoder().encode(body).length) + "\r\n\r\n" + body;
}

function uriOf(path: string): string {
  return pathToFileURL(path).href;
}

// A running 'fishc lsp', spoken to through two named pipes, since a child's stdin can't be written
// while it runs, and the messages it has sent that nothing has taken yet.
class Server {
  child: Subprocess;
  toServer: FileHandle;
  fromServer: FileHandle;
  pending: u8[] = [];
  received: Json[] = [];
  ids: i64 = 0;

  constructor(child: Subprocess, toServer: FileHandle, fromServer: FileHandle) {
    this.child = child;
    this.toServer = toServer;
    this.fromServer = fromServer;
  }

  async raw(this: Mut<this>, text: string): Promise<void> throws IoError {
    await this.toServer.write(new TextEncoder().encode(text));
  }

  async notify(this: Mut<this>, method: string, params: string = "{}"): Promise<void> throws IoError {
    await this.raw(frame("{\"jsonrpc\":\"2.0\",\"method\":" + JSON.stringify(method) + ",\"params\":" + params + "}"));
  }

  async request(this: Mut<this>, method: string, params: string = "{}"): Promise<i64> throws IoError {
    this.ids += 1;
    const id = this.ids;
    await this.raw(frame("{\"jsonrpc\":\"2.0\",\"id\":" + String(id) + ",\"method\":" + JSON.stringify(method) + ",\"params\":" + params + "}"));
    return id;
  }

  // Takes whole frames out of what has arrived, parsing each body.
  private frames(this: Mut<this>): void throws JsonError {
    for (;;) {
      const text = new TextDecoder().decode(this.pending);
      const end = text.indexOf("\r\n\r\n");
      if (end < 0) return;
      const length = /content-length: *(\d+)/i.exec(text.slice(0, end));
      const start = new TextEncoder().encode(text.slice(0, end + 4)).length;
      if (length === null) {
        this.pending = this.pending.slice(start as i64);
        continue;
      }
      const size = (parseInt(length[1]!) ?? 0) as usize;
      if (this.pending.length < start + size) return;
      const body = new TextDecoder().decode(this.pending.slice(start as i64, (start + size) as i64));
      this.pending = this.pending.slice((start + size) as i64);
      this.received.push(JSON.parse(body));
    }
  }

  // The first message 'matches' holds for, dropping those before it, read as they arrive.
  async next(this: Mut<this>, matches: (m: Json) => boolean): Promise<Json> throws IoError | JsonError {
    for (;;) {
      for (let i: usize = 0; i < this.received.length; i++) {
        if (!matches(this.received[i]!.clone())) continue;
        const found = this.received[i]!.clone();
        this.received = this.received.slice((i + 1) as i64);
        return found;
      }
      let buffer: u8[] = new Array<u8>(65536).fill(0);
      const got = await this.fromServer.read(buffer);
      if (got.bytesRead === 0) throw new IoError("the server closed its output");
      for (const b of buffer.slice(0, got.bytesRead)) this.pending.push(b);
      this.frames();
    }
  }
}

// 'fishc lsp' started in 'dir', reading one named pipe and writing the other.
async function server(fishc: string, dir: string, n: i64): Promise<Server> throws IoError {
  const [inPipe, outPipe] = [join(dir, "lsp-in-" + String(n)), join(dir, "lsp-out-" + String(n))];
  const pipes = [inPipe.clone(), outPipe.clone()];
  const _made = await spawnBlocking(() => spawnSync("mkfifo", pipes));
  const child = Bun.spawn(["sh", "-c", "exec \"$1\" lsp < \"$2\" > \"$3\"", "sh", fishc, inPipe, outPipe], { stdout: "ignore", stderr: "ignore" });
  const toServer = await open(inPipe, "w");
  const fromServer = await open(outPipe, "r");
  return new Server(child, toServer, fromServer);
}

async function started(fishc: string, dir: string, n: i64): Promise<Server> throws IoError | JsonError {
  let s = await server(fishc, dir, n);
  const init = await s.request("initialize", "{\"capabilities\":{}}");
  const _done = await s.next(answering(init));
  await s.notify("initialized");
  return s;
}

// Whether a message answers the request 'id', or for 'id' -1, one that answers none.
function answering(id: i64): (m: Json) => boolean {
  return (m) => has(m, "id") && canon(at(m, "id")) === (id < 0 ? "null" : String(id));
}

function published(uri: string): (m: Json) => boolean {
  return (m) => at(m, "method") === "textDocument/publishDiagnostics" && at(at(m, "params"), "uri") === uri;
}

function diagnostics(m: Ref<Json>): Json[] {
  return items(at(at(m, "params"), "diagnostics"));
}

async function opened(s: Mut<Server>, uri: string, text: string): Promise<void> throws IoError {
  await s.notify("textDocument/didOpen", "{\"textDocument\":{\"uri\":" + JSON.stringify(uri) + ",\"languageId\":\"fish\",\"version\":1,\"text\":" + JSON.stringify(text) + "}}");
}

async function changed(s: Mut<Server>, uri: string, version: i64, text: string): Promise<void> throws IoError {
  await s.notify("textDocument/didChange", "{\"textDocument\":{\"uri\":" + JSON.stringify(uri) + ",\"version\":" + String(version) + "},\"contentChanges\":[{\"text\":" + JSON.stringify(text) + "}]}");
}

// Shuts the server down as the protocol asks and gives its exit code.
async function finish(s: Mut<Server>): Promise<string> throws IoError {
  const _id = await s.request("shutdown");
  await s.notify("exit");
  await s.toServer.close();
  const code = await s.child.exited;
  return String(code);
}
`;
}

// The facts a driver whose body is `driver` printed, with `dir` the directory its files are in.
// `fishc` and `dir` are in scope there, and `facts`, which it fills; an error that stops it is the
// fact "error".
function run(dir: string, driver: string): string {
  const program = `${prelude()}
async function drive(fishc: string, dir: string, facts: Mut<Map<string, string>>): Promise<void> throws IoError | JsonError {
${driver}
}

async function main(): Promise<void> {
  let facts = new Map<string, string>();
  try {
    await drive(process.argv[2]!, process.argv[3]!, facts);
  } catch (e) {
    facts.set("error", e.message);
  }
  let lines: string[] = [];
  for (const [k, v] of facts) lines.push(k + "\\t" + JSON.stringify(v));
  console.log(lines.join("\\n"));
}
`;
  const out = built(dir, "drive", program);
  const ran = spawnSync(out, [fishcPath(), dir], { cwd: dir });
  return text(ran.stdout);
}

// The driver's fact `name`, failing the test when the driver stopped with an error.
function fact(facts: string, name: string): string {
  let found = "(no fact)";
  for (const l of facts.split("\n")) {
    const tab = l.indexOf("\t");
    if (tab < 0) continue;
    const key = l.slice(0, tab as i64);
    let value = "";
    try {
      value = JSON.parse<string>(l.slice((tab + 1) as i64));
    } catch (e) {
      assert(false, `an unreadable fact: ${l}`);
    }
    assert(key !== "error", `the driver failed: ${value}`);
    if (key === name) found = value;
  }
  return found;
}

function exited(facts: string, code: i64): void {
  same(fact(facts, "exit"), `${code}`, "the server's exit code");
}

test("the server starts, refuses what it doesn't know, and shuts down", () => {
  const dir = scratch("fishc-lsp-");
  const r = run(dir, String.raw`let s = await server(fishc, dir, 0);
const init = await s.request("initialize", "{\"capabilities\":{}}");
const initialized = await s.next(answering(init));
facts.set("init", canon(at(initialized, "result")));
await s.notify("initialized");
await s.notify("$/somethingNew");
const unknown = await s.request("textDocument/somethingNew");
const refused = await s.next(answering(unknown));
facts.set("unknown", canon(at(at(refused, "error"), "code")));
await s.notify("textDocument/didChange", "{\"textDocument\":{\"uri\":\"file:///x.fsh\"}}");
const log = await s.next((m) => at(m, "method") === "window/logMessage");
facts.set("log", canon(at(at(log, "params"), "type")));
await s.raw(frame("{not json"));
const unreadable = await s.next(answering(-1));
facts.set("parse", canon(at(at(unreadable, "error"), "code")));
const shutdown = await s.request("shutdown");
const shut = await s.next(answering(shutdown));
facts.set("shutdown", canon(at(shut, "result")));
await s.notify("exit");
await s.toServer.close();
const code = await s.child.exited;
facts.set("exit", String(code));`);
  same(fact(r, "init"), `{"capabilities":{"codeLensProvider":{"resolveProvider":false},"completionProvider":{"triggerCharacters":["."]},"definitionProvider":true,"documentFormattingProvider":true,"hoverProvider":true,"inlayHintProvider":true,"referencesProvider":true,"textDocumentSync":1},"serverInfo":{"name":"fishc"}}`, "initialize's result");
  same(fact(r, "unknown"), "-32601", "an unknown request's error code");
  same(fact(r, "log"), "1", "the logged message's type");
  same(fact(r, "parse"), "-32700", "unreadable JSON's error code");
  same(fact(r, "shutdown"), "null", "shutdown's result");
  exited(r, 0);
  removed(dir);
}, { timeout: 20_000 });

test("exit without shutdown is a failure, as the protocol says", () => {
  const dir = scratch("fishc-lsp-");
  const r = run(dir, String.raw`let s = await server(fishc, dir, 0);
await s.notify("exit");
await s.toServer.close();
const code = await s.child.exited;
facts.set("exit", String(code));`);
  exited(r, 1);
  removed(dir);
}, { timeout: 20_000 });

test("a document's error is published at its place, and cleared when fixed or closed", () => {
  const dir = scratch("fishc-lsp-");
  const line = '  const _s: string = "😀"; const _n: i64 = true;';
  const src = `function main() {\n${line}\n}\n`;
  file(dir, "typo.fsh", src);
  const r = run(dir, `const src = ${JSON.stringify(src)};
const uri = uriOf(join(dir, "typo.fsh"));
let s = await started(fishc, dir, 0);
await opened(s, uri, src);
const first = await s.next(published(uri));
const found = diagnostics(first);
const d = item(at(at(first, "params"), "diagnostics"), 0);
const more: Json = found.slice(1);
facts.set("more", canon(more));
facts.set("range", canon(at(d, "range")));
facts.set("severity", shown(at(d, "severity")));
facts.set("code", shown(at(d, "code")));
facts.set("source", shown(at(d, "source")));
await changed(s, uri, 2, src.replace("true", "1"));
const fixed = await s.next(published(uri));
facts.set("fixed", canon(at(at(fixed, "params"), "diagnostics")));
await s.notify("textDocument/didClose", "{\\"textDocument\\":{\\"uri\\":" + JSON.stringify(uri) + "}}");
const closed = await s.next(published(uri));
facts.set("closed", canon(at(at(closed, "params"), "diagnostics")));
const code = await finish(s);
facts.set("exit", code);`);
  const at = line.indexOf("true");
  same(fact(r, "more"), "[]", "the diagnostics after the first");
  same(fact(r, "range"), `{"end":{"character":${at + 4},"line":1},"start":{"character":${at},"line":1}}`, "the error's range");
  same(fact(r, "severity"), "1", "the severity");
  same(fact(r, "code"), "E0101", "the code");
  same(fact(r, "source"), "fish", "the source");
  same(fact(r, "fixed"), "[]", "the diagnostics once fixed");
  same(fact(r, "closed"), "[]", "the diagnostics once closed");
  exited(r, 0);
  removed(dir);
}, { timeout: 20_000 });

test("each function's error in a document is published, in source order", () => {
  const dir = scratch("fishc-lsp-");
  const src = 'function a(): i64 {\n  return "x";\n}\nfunction main() {\n  const _n: i64 = true;\n  console.log(a());\n}\n';
  file(dir, "several.fsh", src);
  const r = run(dir, `const src = ${JSON.stringify(src)};
const uri = uriOf(join(dir, "several.fsh"));
let s = await started(fishc, dir, 0);
await opened(s, uri, src);
const first = await s.next(published(uri));
let found: string[] = [];
for (const d of diagnostics(first)) found.push("[" + canon(at(d, "severity")) + "," + canon(at(d, "code")) + "," + canon(at(at(d, "range"), "start")) + "]");
facts.set("found", "[" + found.join(",") + "]");
const code = await finish(s);
facts.set("exit", code);`);
  same(fact(r, "found"), `[[1,"E0101",{"character":9,"line":1}],[1,"E0101",{"character":18,"line":4}]]`, "the diagnostics");
  exited(r, 0);
  removed(dir);
}, { timeout: 20_000 });

test("a document's warnings are published with warning severity, and an error replaces them", () => {
  const dir = scratch("fishc-lsp-");
  const src = "function main() {\n  const unused = 1;\n  return;\n  print(2);\n}\n";
  file(dir, "warned.fsh", src);
  const r = run(dir, `const src = ${JSON.stringify(src)};
const uri = uriOf(join(dir, "warned.fsh"));
let s = await started(fishc, dir, 0);
await opened(s, uri, src);
const first = await s.next(published(uri));
let found: string[] = [];
for (const d of diagnostics(first)) found.push("[" + canon(at(d, "severity")) + "," + canon(at(d, "code")) + "," + canon(at(d, "message")) + "," + canon(at(at(d, "range"), "start")) + "]");
facts.set("found", "[" + found.join(",") + "]");
await changed(s, uri, 2, src.replace("= 1", "= true + 1"));
const broken = await s.next(published(uri));
let severities: string[] = [];
for (const d of diagnostics(broken)) severities.push(canon(at(d, "severity")));
facts.set("broken", "[" + severities.join(",") + "]");
const code = await finish(s);
facts.set("exit", code);`);
  same(fact(r, "found"), `[[2,"W0001","unused variable 'unused'; if it's intentional, name it '_unused'",{"character":8,"line":1}],[2,"W0002","unreachable code after 'return'",{"character":2,"line":3}]]`, "the warnings");
  same(fact(r, "broken"), "[1]", "the severities once broken");
  exited(r, 0);
  removed(dir);
}, { timeout: 20_000 });

test("a misspelled name's diagnostic suggests the near name", () => {
  const dir = scratch("fishc-lsp-");
  const src = "function main() {\n  const count = 1;\n  print(cont);\n}\n";
  file(dir, "suggest.fsh", src);
  const r = run(dir, `const src = ${JSON.stringify(src)};
const uri = uriOf(join(dir, "suggest.fsh"));
let s = await started(fishc, dir, 0);
await opened(s, uri, src);
const first = await s.next(published(uri));
const d = item(at(at(first, "params"), "diagnostics"), 0);
facts.set("message", shown(at(d, "message")));
facts.set("start", canon(at(at(d, "range"), "start")));
const code = await finish(s);
facts.set("exit", code);`);
  same(fact(r, "message"), "cannot find name 'cont'; did you mean 'count'?", "the message");
  same(fact(r, "start"), `{"character":8,"line":2}`, "where it starts");
  exited(r, 0);
  removed(dir);
}, { timeout: 20_000 });

test("a document that can't be checked is logged, and the server keeps serving", () => {
  const dir = scratch("fishc-lsp-");
  const r = run(dir, String.raw`const uri = uriOf(join(dir, "never-saved.fsh"));
let s = await started(fishc, dir, 0);
await opened(s, uri, "function main() {}\n");
const log = await s.next((m) => at(m, "method") === "window/logMessage");
facts.set("log", canon(at(at(log, "params"), "type")));
const shutdown = await s.request("shutdown");
const shut = await s.next(answering(shutdown));
facts.set("shutdown", canon(at(shut, "result")));
await s.notify("exit");
await s.toServer.close();
const code = await s.child.exited;
facts.set("exit", String(code));`);
  same(fact(r, "log"), "1", "the logged message's type");
  same(fact(r, "shutdown"), "null", "shutdown's result");
  exited(r, 0);
  removed(dir);
}, { timeout: 20_000 });

test("an error in an imported file shows on the importer, saying where it is", () => {
  const dir = scratch("fishc-lsp-");
  made(join(dir, "imports"));
  file(dir, "imports/util.fsh", "export function half(n: i64): i64 {\n  return n / true;\n}\n");
  const src = 'import { half } from "./util.fsh";\nfunction main() { print(half(4)); }\n';
  file(dir, "imports/main.fsh", src);
  const r = run(dir, `const src = ${JSON.stringify(src)};
const uri = uriOf(join(dir, "imports/main.fsh"));
let s = await started(fishc, dir, 0);
await opened(s, uri, src);
const first = await s.next(published(uri));
const d = item(at(at(first, "params"), "diagnostics"), 0);
facts.set("range", canon(at(d, "range")));
facts.set("message", shown(at(d, "message")));
facts.set("related", shown(at(at(item(at(d, "relatedInformation"), 0), "location"), "uri")));
facts.set("util", uriOf(join(dir, "imports/util.fsh")));
const code = await finish(s);
facts.set("exit", code);`);
  same(fact(r, "range"), `{"end":{"character":0,"line":0},"start":{"character":0,"line":0}}`, "the range");
  assert(fact(r, "message").startsWith("util.fsh:2:"), `the message: ${fact(r, "message")}`);
  same(fact(r, "related"), fact(r, "util"), "the related location's uri");
  exited(r, 0);
  removed(dir);
}, { timeout: 20_000 });

test("an importer sees an open file's unsaved text, breaking and fixing it", () => {
  const dir = scratch("fishc-lsp-");
  made(join(dir, "unsaved"));
  const good = "export function half(n: i64): i64 {\n  return n / 2;\n}\n";
  file(dir, "unsaved/util.fsh", good);
  const src = 'import { half } from "./util.fsh";\nfunction main() { print(half(4)); }\n';
  file(dir, "unsaved/main.fsh", src);
  const r = run(dir, `const src = ${JSON.stringify(src)};
const good = ${JSON.stringify(good)};
const utilUri = uriOf(join(dir, "unsaved/util.fsh"));
const uri = uriOf(join(dir, "unsaved/main.fsh"));
let s = await started(fishc, dir, 0);
await opened(s, uri, src);
const before = await s.next(published(uri));
facts.set("before", canon(at(at(before, "params"), "diagnostics")));
await opened(s, utilUri, good.replace("/ 2", "/ true"));
const broken = await s.next(published(uri));
facts.set("broken", shown(at(item(at(at(broken, "params"), "diagnostics"), 0), "message")));
await changed(s, utilUri, 2, good);
const fixed = await s.next(published(uri));
facts.set("fixed", canon(at(at(fixed, "params"), "diagnostics")));
const code = await finish(s);
facts.set("exit", code);`);
  same(fact(r, "before"), "[]", "the diagnostics before");
  assert(fact(r, "broken").startsWith("util.fsh:2:"), `the message once broken: ${fact(r, "broken")}`);
  same(fact(r, "fixed"), "[]", "the diagnostics once fixed");
  exited(r, 0);
  removed(dir);
}, { timeout: 20_000 });

function hinted(): string {
  return `class Oops {
  code: i64 = 1;
}
class ApiError implements From<Oops> {
  why: string;
  constructor(why: string) {
    this.why = why;
  }
  static from(e: Oops): ApiError {
    return new ApiError("wrapped");
  }
}
function risky(n: i64): i64 throws Oops {
  if (n < 0) throw new Oops();
  return n;
}
async function later(n: i64): Promise<i64> throws Oops {
  return risky(n);
}
function wrapped(): i64 throws ApiError {
  return risky(1);
}
async function main() {
  try {
    print(risky(2));
    const three = await later(3);
    print(three);
  } catch (e) {
    print(e.code);
  }
}
`;
}

// A hint, as JSON with its keys sorted, at where `text` ends in the line holding it.
function hint(src: string, text: string, tooltip: string): string {
  const lines = src.split("\n");
  let line: usize = 0;
  while (line < lines.length && !lines[line].includes(text)) line++;
  const character = (lines[line].indexOf(text) as usize) + text.length;
  const tip = tooltip === "" ? "" : `,"tooltip":${JSON.stringify(tooltip)}`;
  return `{"label":"throws Oops","paddingLeft":true,"position":{"character":${character},"line":${line}}${tip}}`;
}

test("fallible calls and awaits are hinted with what they throw", () => {
  const dir = scratch("fishc-lsp-");
  const src = hinted();
  file(dir, "hinted.fsh", src);
  const r = run(dir, `const src = ${JSON.stringify(src)};
const uri = uriOf(join(dir, "hinted.fsh"));
let s = await started(fishc, dir, 0);
await opened(s, uri, src);
const all = "{\\"start\\":{\\"line\\":0,\\"character\\":0},\\"end\\":{\\"line\\":99,\\"character\\":0}}";
const asked = (range: string): string => "{\\"textDocument\\":{\\"uri\\":" + JSON.stringify(uri) + "},\\"range\\":" + range + "}";
const id = await s.request("textDocument/inlayHint", asked(all));
const hinted = await s.next(answering(id));
facts.set("all", canon(at(hinted, "result")));
const some = await s.request("textDocument/inlayHint", asked("{\\"start\\":{\\"line\\":0,\\"character\\":0},\\"end\\":{\\"line\\":18,\\"character\\":0}}"));
const first = await s.next(answering(some));
let lines: string[] = [];
for (const h of items(at(first, "result"))) lines.push(canon(at(at(h, "position"), "line")));
facts.set("some", "[" + lines.join(",") + "]");
await changed(s, uri, 2, src.replace("return n;", "return true;"));
const broken = await s.request("textDocument/inlayHint", asked(all));
const none = await s.next(answering(broken));
facts.set("broken", canon(at(none, "result")));
const code = await finish(s);
facts.set("exit", code);`);
  const want = [hint(src, "  return risky(n)", ""), hint(src, "  return risky(1)", "becomes 'ApiError' through 'From'"), hint(src, "print(risky(2)", ""), hint(src, "await later(3)", "")];
  same(fact(r, "all"), `[${want.join(",")}]`, "the hints");
  same(fact(r, "some"), "[17]", "the lines hinted in the first lines");
  same(fact(r, "broken"), "[]", "the hints once broken");
  exited(r, 0);
  removed(dir);
}, { timeout: 20_000 });

test("a TS-compat document is refused at its directive, pointing at fishc lint", () => {
  const dir = scratch("fishc-lsp-");
  const src = "// @fish-edition ts-compat\nfunction main() {}\n";
  file(dir, "compat.fsh", src);
  const r = run(dir, `const src = ${JSON.stringify(src)};
const uri = uriOf(join(dir, "compat.fsh"));
let s = await started(fishc, dir, 0);
await opened(s, uri, src);
const first = await s.next(published(uri));
const found = diagnostics(first);
const d = item(at(at(first, "params"), "diagnostics"), 0);
const more: Json = found.slice(1);
facts.set("more", canon(more));
facts.set("range", canon(at(d, "range")));
facts.set("message", shown(at(d, "message")));
await changed(s, uri, 2, src.replace("ts-compat", "native"));
const fixed = await s.next(published(uri));
facts.set("fixed", canon(at(at(fixed, "params"), "diagnostics")));
const code = await finish(s);
facts.set("exit", code);`);
  same(fact(r, "more"), "[]", "the diagnostics after the first");
  same(fact(r, "range"), `{"end":{"character":26,"line":0},"start":{"character":0,"line":0}}`, "the range");
  assert(fact(r, "message").includes("run 'fishc lint'"), `the message: ${fact(r, "message")}`);
  same(fact(r, "fixed"), "[]", "the diagnostics once native");
  exited(r, 0);
  removed(dir);
}, { timeout: 20_000 });
