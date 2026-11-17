// Ports tests/lsp.test.ts: checking documents and splitting frames in process, through the
// compiler's own functions, and `fishc lsp` itself as the native fishc. A Fish child's output comes
// whole once it ends, while the server is driven message by message, so each server test runs a
// Bun driver, a reference harness only, that starts `fishc lsp`, speaks the protocol to it as the
// Bun test does, and prints what it saw once done: one fact per line, a name, a tab and a JSON
// string. Objects in a fact are written with their keys sorted, as Fish's JSON.stringify writes
// them, so the expected JSON below is written that way too.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compiledOf } from "../compiler/codegen.fsh";
import { newCompilation } from "../compiler/compilation.fsh";
import { CompileError } from "../compiler/diag.fsh";
import { frames } from "../compiler/lsp.fsh";
import { analyze } from "../compiler/main.fsh";
import { load } from "../compiler/modules.fsh";
import { cachedSession } from "../compiler/stdcache.fsh";
import { fishcPath, removed, same, scratch, text } from "./support.fsh";

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

// What every driver starts with: a running `fishc lsp` and the messages it has sent, as the Bun
// test's `server()` and `started()`.
function prelude(): string {
  return String.raw`const { join } = require("node:path");
const fishc = process.argv[2];
const facts = {};
const procs = [];
function canon(v) {
  const s = JSON.stringify(v, (_k, x) => (x !== null && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
  return s === undefined ? "undefined" : s;
}
const frame = (body) => "Content-Length: " + Buffer.byteLength(body) + "\r\n\r\n" + body;
function frames(buffer) {
  const bodies = [];
  let at = 0;
  for (;;) {
    const end = buffer.indexOf("\r\n\r\n", at);
    if (end < 0) break;
    const length = /content-length: *(\d+)/i.exec(buffer.subarray(at, end).toString());
    const start = end + 4;
    if (length === null) {
      at = start;
      continue;
    }
    const size = Number(length[1]);
    if (buffer.length < start + size) break;
    bodies.push(buffer.subarray(start, start + size).toString());
    at = start + size;
  }
  return { bodies, rest: buffer.subarray(at) };
}
function server() {
  const proc = Bun.spawn([fishc, "lsp"], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  procs.push(proc);
  const received = [];
  const waiting = [];
  (async () => {
    let pending = Buffer.alloc(0);
    for await (const chunk of proc.stdout) {
      const { bodies, rest } = frames(Buffer.concat([pending, Buffer.from(chunk)]));
      pending = rest;
      received.push(...bodies.map((b) => JSON.parse(b)));
      waiting.splice(0).forEach((go) => go());
    }
  })();
  const raw = (text) => {
    proc.stdin.write(text);
    proc.stdin.flush();
  };
  let ids = 0;
  return {
    proc,
    raw,
    notify: (method, params = {}) => raw(frame(JSON.stringify({ jsonrpc: "2.0", method, params }))),
    request: (method, params = {}) => {
      const id = ++ids;
      raw(frame(JSON.stringify({ jsonrpc: "2.0", id, method, params })));
      return id;
    },
    async next(matches) {
      const deadline = Date.now() + 10_000;
      for (;;) {
        const at = received.findIndex(matches);
        if (at >= 0) return received.splice(0, at + 1).at(-1);
        if (Date.now() > deadline) throw new Error("no matching message from the server");
        await new Promise((go) => {
          waiting.push(go);
          setTimeout(go, 100);
        });
      }
    },
  };
}
async function started() {
  const s = server();
  const init = s.request("initialize", { capabilities: {} });
  await s.next((m) => m.id === init);
  s.notify("initialized");
  return s;
}
const published = (uri) => (m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === uri;
const diagnostics = (m) => m.params.diagnostics;
const opened = (s, uri, text) => s.notify("textDocument/didOpen", { textDocument: { uri, languageId: "fish", version: 1, text } });
const changed = (s, uri, version, text) => s.notify("textDocument/didChange", { textDocument: { uri, version }, contentChanges: [{ text }] });
async function finish(s) {
  s.request("shutdown");
  s.notify("exit");
  facts.exit = await s.proc.exited;
}
`;
}

// Printing the facts once `drive()` ends, or the error that stopped it, which kills the servers.
function finished(): string {
  return String.raw`drive()
  .then(
    () => {},
    (e) => {
      facts.error = e.message;
      for (const p of procs) p.kill(9);
    },
  )
  .then(() => {
    process.stdout.write(Object.entries(facts).map(([k, v]) => k + "\t" + JSON.stringify(String(v))).join("\n"));
    process.exit(0);
  });
`;
}

// The facts a driver whose `drive()` body is `driver` printed, with `dir` the directory its files are in.
function run(dir: string, driver: string): string {
  const drv = file(dir, "drive.ts", `${prelude()}\nconst dir = ${JSON.stringify(dir)};\nasync function drive() {\n${driver}\n}\n${finished()}`);
  const ran = spawnSync("bun", [drv, fishcPath()], { cwd: dir });
  const failed = ran.error;
  if (failed !== null) assert(false, `can't run bun: ${failed.message}`);
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
  const r = run(dir, String.raw`const s = server();
const init = s.request("initialize", { capabilities: {} });
facts.init = canon((await s.next((m) => m.id === init)).result);
s.notify("initialized");
s.notify("$/somethingNew");
const unknown = s.request("textDocument/somethingNew");
facts.unknown = canon((await s.next((m) => m.id === unknown)).error?.code);
s.notify("textDocument/didChange", { textDocument: { uri: "file:///x.fsh" } });
facts.log = canon((await s.next((m) => m.method === "window/logMessage")).params.type);
s.raw(frame("{not json"));
facts.parse = canon((await s.next((m) => m.id === null)).error?.code);
const shutdown = s.request("shutdown");
facts.shutdown = canon((await s.next((m) => m.id === shutdown)).result);
s.notify("exit");
facts.exit = await s.proc.exited;`);
  same(fact(r, "init"), `{"capabilities":{"inlayHintProvider":true,"textDocumentSync":1},"serverInfo":{"name":"fishc"}}`, "initialize's result");
  same(fact(r, "unknown"), "-32601", "an unknown request's error code");
  same(fact(r, "log"), "1", "the logged message's type");
  same(fact(r, "parse"), "-32700", "unreadable JSON's error code");
  same(fact(r, "shutdown"), "null", "shutdown's result");
  exited(r, 0);
  removed(dir);
}, { timeout: 20_000 });

test("exit without shutdown is a failure, as the protocol says", () => {
  const dir = scratch("fishc-lsp-");
  const r = run(dir, String.raw`const s = server();
s.notify("exit");
facts.exit = await s.proc.exited;`);
  exited(r, 1);
  removed(dir);
}, { timeout: 20_000 });

test("a document's error is published at its place, and cleared when fixed or closed", () => {
  const dir = scratch("fishc-lsp-");
  const line = '  const _s: string = "😀"; const _n: i64 = true;';
  const src = `function main() {\n${line}\n}\n`;
  file(dir, "typo.fsh", src);
  const r = run(dir, `const src = ${JSON.stringify(src)};
const uri = Bun.pathToFileURL(join(dir, "typo.fsh")).href;
const s = await started();
opened(s, uri, src);
const [d, ...more] = diagnostics(await s.next(published(uri)));
facts.more = canon(more);
facts.range = canon(d.range);
facts.severity = d.severity;
facts.code = d.code;
facts.source = d.source;
changed(s, uri, 2, src.replace("true", "1"));
facts.fixed = canon(diagnostics(await s.next(published(uri))));
s.notify("textDocument/didClose", { textDocument: { uri } });
facts.closed = canon(diagnostics(await s.next(published(uri))));
await finish(s);`);
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
const uri = Bun.pathToFileURL(join(dir, "several.fsh")).href;
const s = await started();
opened(s, uri, src);
facts.found = canon(diagnostics(await s.next(published(uri))).map((d) => [d.severity, d.code, d.range.start]));
await finish(s);`);
  same(fact(r, "found"), `[[1,"E0101",{"character":9,"line":1}],[1,"E0101",{"character":18,"line":4}]]`, "the diagnostics");
  exited(r, 0);
  removed(dir);
}, { timeout: 20_000 });

test("a document's warnings are published with warning severity, and an error replaces them", () => {
  const dir = scratch("fishc-lsp-");
  const src = "function main() {\n  const unused = 1;\n  return;\n  print(2);\n}\n";
  file(dir, "warned.fsh", src);
  const r = run(dir, `const src = ${JSON.stringify(src)};
const uri = Bun.pathToFileURL(join(dir, "warned.fsh")).href;
const s = await started();
opened(s, uri, src);
facts.found = canon(diagnostics(await s.next(published(uri))).map((d) => [d.severity, d.code, d.message, d.range.start]));
changed(s, uri, 2, src.replace("= 1", "= true + 1"));
facts.broken = canon(diagnostics(await s.next(published(uri))).map((d) => d.severity));
await finish(s);`);
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
const uri = Bun.pathToFileURL(join(dir, "suggest.fsh")).href;
const s = await started();
opened(s, uri, src);
const [d] = diagnostics(await s.next(published(uri)));
facts.message = d.message;
facts.start = canon(d.range.start);
await finish(s);`);
  same(fact(r, "message"), "cannot find name 'cont'; did you mean 'count'?", "the message");
  same(fact(r, "start"), `{"character":8,"line":2}`, "where it starts");
  exited(r, 0);
  removed(dir);
}, { timeout: 20_000 });

test("a document that can't be checked is logged, and the server keeps serving", () => {
  const dir = scratch("fishc-lsp-");
  const r = run(dir, String.raw`const uri = Bun.pathToFileURL(join(dir, "never-saved.fsh")).href;
const s = await started();
opened(s, uri, "function main() {}\n");
facts.log = canon((await s.next((m) => m.method === "window/logMessage")).params.type);
const shutdown = s.request("shutdown");
facts.shutdown = canon((await s.next((m) => m.id === shutdown)).result);
s.notify("exit");
facts.exit = await s.proc.exited;`);
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
const uri = Bun.pathToFileURL(join(dir, "imports/main.fsh")).href;
const s = await started();
opened(s, uri, src);
const [d] = diagnostics(await s.next(published(uri)));
facts.range = canon(d.range);
facts.message = d.message;
facts.related = d.relatedInformation?.[0]?.location.uri;
facts.util = Bun.pathToFileURL(join(dir, "imports/util.fsh")).href;
await finish(s);`);
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
const utilUri = Bun.pathToFileURL(join(dir, "unsaved/util.fsh")).href;
const uri = Bun.pathToFileURL(join(dir, "unsaved/main.fsh")).href;
const s = await started();
opened(s, uri, src);
facts.before = canon(diagnostics(await s.next(published(uri))));
opened(s, utilUri, good.replace("/ 2", "/ true"));
facts.broken = diagnostics(await s.next(published(uri)))[0].message;
changed(s, utilUri, 2, good);
facts.fixed = canon(diagnostics(await s.next(published(uri))));
await finish(s);`);
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
const uri = Bun.pathToFileURL(join(dir, "hinted.fsh")).href;
const s = await started();
opened(s, uri, src);
const all = { start: { line: 0, character: 0 }, end: { line: 99, character: 0 } };
const id = s.request("textDocument/inlayHint", { textDocument: { uri }, range: all });
facts.all = canon((await s.next((m) => m.id === id)).result);
const firstLines = { start: { line: 0, character: 0 }, end: { line: 18, character: 0 } };
const some = s.request("textDocument/inlayHint", { textDocument: { uri }, range: firstLines });
facts.some = canon((await s.next((m) => m.id === some)).result.map((h) => h.position.line));
changed(s, uri, 2, src.replace("return n;", "return true;"));
const broken = s.request("textDocument/inlayHint", { textDocument: { uri }, range: all });
facts.broken = canon((await s.next((m) => m.id === broken)).result);
await finish(s);`);
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
const uri = Bun.pathToFileURL(join(dir, "compat.fsh")).href;
const s = await started();
opened(s, uri, src);
const [d, ...more] = diagnostics(await s.next(published(uri)));
facts.more = canon(more);
facts.range = canon(d.range);
facts.message = d.message;
changed(s, uri, 2, src.replace("ts-compat", "native"));
facts.fixed = canon(diagnostics(await s.next(published(uri))));
await finish(s);`);
  same(fact(r, "more"), "[]", "the diagnostics after the first");
  same(fact(r, "range"), `{"end":{"character":26,"line":0},"start":{"character":0,"line":0}}`, "the range");
  assert(fact(r, "message").includes("run 'fishc lint'"), `the message: ${fact(r, "message")}`);
  same(fact(r, "fixed"), "[]", "the diagnostics once native");
  exited(r, 0);
  removed(dir);
}, { timeout: 20_000 });
