import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompileError } from "../src/diag.ts";
import { analyze } from "../src/main.ts";
import { frames } from "../src/lsp.ts";
import { load } from "../src/modules.ts";
import { newCompilation } from "../src/compilation.ts";
import { cachedSession } from "../src/stdcache.ts";

const session = cachedSession();

const dir = mkdtempSync(join(tmpdir(), "fishc-lsp-"));

// A file in the test's directory holding `src`, as an editor's file would be on disk.
function file(name: string, src: string): string {
  const path = join(dir, name);
  writeFileSync(path, src);
  return path;
}

test("a file without main is checked as a module", () => {
  const src = "export class Oops { code: i64 = 1 }\nexport function f(n: i64): i64 throws Oops {\n  if (n < 0) throw new Oops();\n  return n;\n}\n";
  const { checked } = analyze(session, src, file("module.fsh", src));
  expect(checked.instances.some((i) => i.symbol === "f")).toBe(true);
});

test("a type error is thrown at its span", () => {
  const src = "function main() {\n  const n: i64 = true;\n}\n";
  let error: unknown;
  try {
    analyze(session, src, file("bad.fsh", src));
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(CompileError);
  expect(src.slice((error as CompileError).start, (error as CompileError).end)).toBe("true");
});

test("a type error inside a test block is reported, though a build leaves the block out", () => {
  const src = 'function main() {}\ntest("adds", () => {\n  const n: i64 = "two";\n});\n';
  let error: unknown;
  try {
    analyze(session, src, file("tested.fsh", src));
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(CompileError);
  expect(src.slice((error as CompileError).start, (error as CompileError).end)).toBe('"two"');
  expect(() => analyze(session, 'function main() {}\ntest("adds", () => {\n  assert(1 + 1 === 2);\n});\n', file("passing.fsh", ""))).not.toThrow();
});

test("imported files are read through the reader given", () => {
  file("lib.fsh", "export function two(): i64 { return 2; }\n");
  const src = 'import { three } from "./lib.fsh";\nfunction main() { print(three()); }\n';
  const read = (path: string) => (path.endsWith("lib.fsh") ? "export function three(): i64 { return 3; }\n" : "");
  const loaded = load(newCompilation(session), file("reader.fsh", src), src, read);
  expect(loaded.sources.map((s) => s.src)).toContain("export function three(): i64 { return 3; }\n");
  expect(() => analyze(session, src, join(dir, "reader.fsh"), read)).not.toThrow();
});

const frame = (body: string) => `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;

test("frames are split by their byte lengths, and a partial one waits", () => {
  const both = Buffer.from(frame('{"a":"é"}') + frame('{"b":2}') + "Content-Length: 7\r\n\r\n{\"c\"");
  const { bodies, rest } = frames(both);
  expect(bodies).toEqual(['{"a":"é"}', '{"b":2}']);
  expect(frames(Buffer.concat([rest, Buffer.from(':3}')])).bodies).toEqual(['{"c":3}']);
});

type Reply = { id?: number | null; method?: string; params?: unknown; result?: unknown; error?: { code: number } };

// A running `fishc lsp` and the messages it has sent.
function server() {
  const proc = Bun.spawn(["bun", join(import.meta.dir, "../src/main.ts"), "lsp"], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
  const received: Reply[] = [];
  const waiting: (() => void)[] = [];
  (async () => {
    let pending: Buffer = Buffer.alloc(0);
    for await (const chunk of proc.stdout) {
      const { bodies, rest } = frames(Buffer.concat([pending, Buffer.from(chunk)]));
      pending = rest;
      received.push(...bodies.map((b) => JSON.parse(b) as Reply));
      waiting.splice(0).forEach((go) => go());
    }
  })();
  const raw = (text: string) => {
    proc.stdin.write(text);
    proc.stdin.flush();
  };
  let ids = 0;
  return {
    proc,
    raw,
    notify: (method: string, params: unknown = {}) => raw(frame(JSON.stringify({ jsonrpc: "2.0", method, params }))),
    request: (method: string, params: unknown = {}) => {
      const id = ++ids;
      raw(frame(JSON.stringify({ jsonrpc: "2.0", id, method, params })));
      return id;
    },
    // The first message sent that `matches`, and every one before it is dropped.
    async next(matches: (m: Reply) => boolean): Promise<Reply> {
      const deadline = Date.now() + 10_000;
      for (;;) {
        const at = received.findIndex(matches);
        if (at >= 0) return received.splice(0, at + 1).at(-1)!;
        if (Date.now() > deadline) throw new Error("no matching message from the server");
        await new Promise<void>((go) => {
          waiting.push(go);
          setTimeout(go, 100);
        });
      }
    },
  };
}

test("the server starts, refuses what it doesn't know, and shuts down", async () => {
  const s = server();
  const init = s.request("initialize", { capabilities: {} });
  expect((await s.next((m) => m.id === init)).result).toEqual({ capabilities: { textDocumentSync: 1, inlayHintProvider: true }, serverInfo: { name: "fishc" } });
  s.notify("initialized");
  s.notify("$/somethingNew");
  const unknown = s.request("textDocument/somethingNew");
  expect((await s.next((m) => m.id === unknown)).error?.code).toBe(-32601);
  s.notify("textDocument/didChange", { textDocument: { uri: "file:///x.fsh" } });
  expect((await s.next((m) => m.method === "window/logMessage")).params).toMatchObject({ type: 1 });
  s.raw(frame("{not json"));
  expect((await s.next((m) => m.id === null)).error?.code).toBe(-32700);
  const shutdown = s.request("shutdown");
  expect((await s.next((m) => m.id === shutdown)).result).toBeNull();
  s.notify("exit");
  expect(await s.proc.exited).toBe(0);
}, 20_000);

test("exit without shutdown is a failure, as the protocol says", async () => {
  const s = server();
  s.notify("exit");
  expect(await s.proc.exited).toBe(1);
}, 20_000);

// A server past `initialize`.
async function started() {
  const s = server();
  const init = s.request("initialize", { capabilities: {} });
  await s.next((m) => m.id === init);
  s.notify("initialized");
  return s;
}

type Diagnostic = { range: { start: { line: number; character: number }; end: { line: number; character: number } }; message: string; severity: number; source: string };
const published = (uri: string) => (m: Reply) => m.method === "textDocument/publishDiagnostics" && (m.params as { uri: string }).uri === uri;
const diagnostics = (m: Reply) => (m.params as { diagnostics: Diagnostic[] }).diagnostics;

test("a document's error is published at its place, and cleared when fixed or closed", async () => {
  const line = '  const _s: string = "😀"; const _n: i64 = true;';
  const src = `function main() {\n${line}\n}\n`;
  const uri = Bun.pathToFileURL(file("typo.fsh", src)).href;
  const s = await started();
  s.notify("textDocument/didOpen", { textDocument: { uri, languageId: "fish", version: 1, text: src } });
  const [d, ...more] = diagnostics(await s.next(published(uri)));
  expect(more).toEqual([]);
  expect(d!.range).toEqual({ start: { line: 1, character: line.indexOf("true") }, end: { line: 1, character: line.indexOf("true") + 4 } });
  expect(d!.severity).toBe(1);
  expect(d!.source).toBe("fish");
  s.notify("textDocument/didChange", { textDocument: { uri, version: 2 }, contentChanges: [{ text: src.replace("true", "1") }] });
  expect(diagnostics(await s.next(published(uri)))).toEqual([]);
  s.notify("textDocument/didClose", { textDocument: { uri } });
  expect(diagnostics(await s.next(published(uri)))).toEqual([]);
  s.request("shutdown");
  s.notify("exit");
  expect(await s.proc.exited).toBe(0);
}, 20_000);

test("a document's warnings are published with warning severity, and an error replaces them", async () => {
  const src = "function main() {\n  const unused = 1;\n  return;\n  print(2);\n}\n";
  const uri = Bun.pathToFileURL(file("warned.fsh", src)).href;
  const s = await started();
  s.notify("textDocument/didOpen", { textDocument: { uri, languageId: "fish", version: 1, text: src } });
  const found = diagnostics(await s.next(published(uri)));
  expect(found.map((d) => [d.severity, d.message, d.range.start])).toEqual([
    [2, "unused variable 'unused'; if it's intentional, name it '_unused'", { line: 1, character: 8 }],
    [2, "unreachable code after 'return'", { line: 3, character: 2 }],
  ]);
  s.notify("textDocument/didChange", { textDocument: { uri, version: 2 }, contentChanges: [{ text: src.replace("= 1", "= true + 1") }] });
  expect(diagnostics(await s.next(published(uri))).map((d) => d.severity)).toEqual([1]);
  s.request("shutdown");
  s.notify("exit");
  expect(await s.proc.exited).toBe(0);
}, 20_000);

test("a misspelled name's diagnostic suggests the near name", async () => {
  const src = "function main() {\n  const count = 1;\n  print(cont);\n}\n";
  const uri = Bun.pathToFileURL(file("suggest.fsh", src)).href;
  const s = await started();
  s.notify("textDocument/didOpen", { textDocument: { uri, languageId: "fish", version: 1, text: src } });
  const [d] = diagnostics(await s.next(published(uri)));
  expect(d!.message).toBe("cannot find name 'cont'; did you mean 'count'?");
  expect(d!.range.start).toEqual({ line: 2, character: 8 });
  s.request("shutdown");
  s.notify("exit");
  expect(await s.proc.exited).toBe(0);
}, 20_000);

test("a document that can't be checked is logged, and the server keeps serving", async () => {
  const uri = Bun.pathToFileURL(join(dir, "never-saved.fsh")).href;
  const s = await started();
  s.notify("textDocument/didOpen", { textDocument: { uri, languageId: "fish", version: 1, text: "function main() {}\n" } });
  expect((await s.next((m) => m.method === "window/logMessage")).params).toMatchObject({ type: 1 });
  const shutdown = s.request("shutdown");
  expect((await s.next((m) => m.id === shutdown)).result).toBeNull();
  s.notify("exit");
  expect(await s.proc.exited).toBe(0);
}, 20_000);

test("an error in an imported file shows on the importer, saying where it is", async () => {
  mkdirSync(join(dir, "imports"), { recursive: true });
  file("imports/util.fsh", "export function half(n: i64): i64 {\n  return n / true;\n}\n");
  const src = 'import { half } from "./util.fsh";\nfunction main() { print(half(4)); }\n';
  const uri = Bun.pathToFileURL(file("imports/main.fsh", src)).href;
  const s = await started();
  s.notify("textDocument/didOpen", { textDocument: { uri, languageId: "fish", version: 1, text: src } });
  const [d] = diagnostics(await s.next(published(uri)));
  expect(d!.range).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 0 } });
  expect(d!.message).toStartWith("util.fsh:2:");
  expect((d as { relatedInformation?: { location: { uri: string } }[] }).relatedInformation?.[0]?.location.uri).toBe(Bun.pathToFileURL(join(dir, "imports/util.fsh")).href);
  s.request("shutdown");
  s.notify("exit");
  expect(await s.proc.exited).toBe(0);
}, 20_000);

test("an importer sees an open file's unsaved text, breaking and fixing it", async () => {
  mkdirSync(join(dir, "unsaved"), { recursive: true });
  const good = "export function half(n: i64): i64 {\n  return n / 2;\n}\n";
  const utilUri = Bun.pathToFileURL(file("unsaved/util.fsh", good)).href;
  const src = 'import { half } from "./util.fsh";\nfunction main() { print(half(4)); }\n';
  const uri = Bun.pathToFileURL(file("unsaved/main.fsh", src)).href;
  const s = await started();
  s.notify("textDocument/didOpen", { textDocument: { uri, languageId: "fish", version: 1, text: src } });
  expect(diagnostics(await s.next(published(uri)))).toEqual([]);
  s.notify("textDocument/didOpen", { textDocument: { uri: utilUri, languageId: "fish", version: 1, text: good.replace("/ 2", "/ true") } });
  expect(diagnostics(await s.next(published(uri)))[0]!.message).toStartWith("util.fsh:2:");
  s.notify("textDocument/didChange", { textDocument: { uri: utilUri, version: 2 }, contentChanges: [{ text: good }] });
  expect(diagnostics(await s.next(published(uri)))).toEqual([]);
  s.request("shutdown");
  s.notify("exit");
  expect(await s.proc.exited).toBe(0);
}, 20_000);

const HINTED = `class Oops {
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

type Hint = { position: { line: number; character: number }; label: string; paddingLeft: boolean; tooltip?: string };
// Where `text` ends in the line holding it.
function after(src: string, text: string) {
  const lines = src.split("\n");
  const line = lines.findIndex((l) => l.includes(text));
  return { line, character: lines[line]!.indexOf(text) + text.length };
}

test("fallible calls and awaits are hinted with what they throw", async () => {
  const uri = Bun.pathToFileURL(file("hinted.fsh", HINTED)).href;
  const s = await started();
  s.notify("textDocument/didOpen", { textDocument: { uri, languageId: "fish", version: 1, text: HINTED } });
  const all = { start: { line: 0, character: 0 }, end: { line: 99, character: 0 } };
  const id = s.request("textDocument/inlayHint", { textDocument: { uri }, range: all });
  const hints = (await s.next((m) => m.id === id)).result as Hint[];
  expect(hints).toEqual([
    { position: after(HINTED, "  return risky(n)"), label: "throws Oops", paddingLeft: true },
    { position: after(HINTED, "  return risky(1)"), label: "throws Oops", paddingLeft: true, tooltip: "becomes 'ApiError' through 'From'" },
    { position: after(HINTED, "print(risky(2)"), label: "throws Oops", paddingLeft: true },
    { position: after(HINTED, "await later(3)"), label: "throws Oops", paddingLeft: true },
  ]);
  const firstLines = { start: { line: 0, character: 0 }, end: { line: 18, character: 0 } };
  const some = s.request("textDocument/inlayHint", { textDocument: { uri }, range: firstLines });
  expect(((await s.next((m) => m.id === some)).result as Hint[]).map((h) => h.position.line)).toEqual([17]);
  s.notify("textDocument/didChange", { textDocument: { uri, version: 2 }, contentChanges: [{ text: HINTED.replace("return n;", "return true;") }] });
  const broken = s.request("textDocument/inlayHint", { textDocument: { uri }, range: all });
  expect((await s.next((m) => m.id === broken)).result).toEqual([]);
  s.request("shutdown");
  s.notify("exit");
  expect(await s.proc.exited).toBe(0);
}, 20_000);

test("a TS-compat document is refused at its directive, pointing at fishc lint", async () => {
  const src = "// @fish-edition ts-compat\nfunction main() {}\n";
  const uri = Bun.pathToFileURL(file("compat.fsh", src)).href;
  const s = await started();
  s.notify("textDocument/didOpen", { textDocument: { uri, languageId: "fish", version: 1, text: src } });
  const [d, ...more] = diagnostics(await s.next(published(uri)));
  expect(more).toEqual([]);
  expect(d!.range).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 26 } });
  expect(d!.message).toContain("run 'fishc lint'");
  s.notify("textDocument/didChange", { textDocument: { uri, version: 2 }, contentChanges: [{ text: src.replace("ts-compat", "native") }] });
  expect(diagnostics(await s.next(published(uri)))).toEqual([]);
  s.request("shutdown");
  s.notify("exit");
  expect(await s.proc.exited).toBe(0);
}, 20_000);
