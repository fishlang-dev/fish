// `fishc lsp`: the Language Server Protocol's JSON-RPC over stdin and stdout.
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { analyze } from "./analysis.ts";
import type { Checked } from "./check.ts";
import { compiledOf } from "./codegen.ts";
import { type Session } from "./compilation.ts";
import { cachedSession } from "./stdcache.ts";
import { CompileError, copyNames, locate, shown, sourceOf, written, type Source } from "./diag.ts";
import { STD_BASE } from "./std.ts";
import type { Type } from "./typing.ts";

// The parameters of the methods served, each of which names a document; the methods that take
// none name nothing.
type Params = { textDocument?: { uri: string; text?: string }; contentChanges?: { text: string }[]; range?: Range };
type Message = { id?: i64 | string | null; method?: string; params?: Params };

type Position = { line: usize; character: usize };
type Range = { start: Position; end: Position };
type Location = { uri: string; range: Range };
type Related = { location: Location; message: string };
type Diagnostic = { range: Range; severity: i64; code: string; source: string; message: string; relatedInformation?: Related[] };
type Hint = { position: Position; label: string; paddingLeft: boolean; tooltip?: string };

// The message bodies whole in `buffer`, and the bytes after them, which wait for more input.
// Each body follows headers ending in a blank line, with `Content-Length` its length in bytes.
export function frames(buffer: Buffer): { bodies: string[]; rest: Buffer } {
  let bodies: string[] = [];
  let at: usize = 0;
  while (true) {
    const end = headersEnd(buffer, at);
    if (end < 0) break;
    const start = (end as usize) + 4;
    const length = /^content-length: *(\d+)/im.exec(new TextDecoder().decode(buffer.slice(at, end as usize)));
    // Headers without a length can't say where the body ends; skip them.
    if (length === null) {
      at = start;
      continue;
    }
    const size = Number(length[1]!) as usize;
    if (buffer.length < start + size) break;
    bodies.push(new TextDecoder().decode(buffer.slice(start, start + size)));
    at = start + size;
  }
  return { bodies, rest: buffer.slice(at) };
}

// Where the blank line ending the headers from `from` starts, or -1 when it hasn't arrived.
function headersEnd(buffer: Ref<Buffer>, from: usize): i64 {
  for (let i = from; i + 3 < buffer.length; i++) if (buffer[i] === 13 && buffer[i + 1] === 10 && buffer[i + 2] === 13 && buffer[i + 3] === 10) return i as i64;
  return -1;
}

// LSP's positions count UTF-16 code units, as the compiler's offsets into a JavaScript string do.
function position(src: string, offset: usize): Position {
  const { line, col } = locate(src, Math.min(offset, src.length));
  return { line: line - 1, character: col - 1 };
}

// Where a span of the program checked from `path` lies, in whichever of its files holds it; std
// has no file an editor can open.
function located(path: string, text: string, sources: Ref<Source[]>, start: usize, end: usize): Location | undefined {
  if (start >= STD_BASE) return undefined;
  const at = sourceOf(text, path, start, sources);
  const range = { start: position(at.src, at.offset), end: position(at.src, at.offset + (end - start)) };
  return { uri: pathToFileURL(resolve(dirname(path), at.file)).href, range };
}

// The diagnostics checking `text`, the document at `path`, gives, with its imports read by `read`
// before the disk, and the checked program when there are none, with its warnings in this
// document. An error in another file shows at the document's start, saying where it is.
/** @throws {Error | IoError} */
function diagnose(session: Session, path: string, text: string, read: (path: string) => string | undefined): { diagnostics: Diagnostic[]; checked?: Checked } {
  try {
    const { checked, sources } = analyze(session, text, path, read);
    const uri = pathToFileURL(path).href;
    let warnings: Diagnostic[] = [];
    for (const w of checked.warnings) {
      const at = located(path, text, sources, w.start, w.end);
      if (at !== undefined && at.uri === uri) warnings.push({ range: at.range, severity: 2, code: w.code, source: "fish", message: shown(w.message, w.names) });
    }
    return { diagnostics: warnings, checked };
  } catch (e) {
    if (!(e instanceof CompileError)) throw e;
    let diagnostics: Diagnostic[] = [];
    for (const x of errorsOf(e)) diagnostics.push(diagnostic(x, path, text));
    return { diagnostics };
  }
}

// An error as a diagnostic of the document at `path`; one in another file is shown at its start,
// naming where it is.
function diagnostic(e: Ref<CompileError>, path: string, text: string): Diagnostic {
  const uri = pathToFileURL(path).href;
  const at = located(path, text, e.sources, e.start, e.end);
  let related: Related[] = [];
  const note = e.note;
  if (note !== undefined) {
    const there = located(path, text, e.sources, note.start, note.end);
    if (there !== undefined) related.push({ location: there, message: shown(note.message, e.names) });
  }
  if (at !== undefined && at.uri === uri) return withRelated({ range: at.range, severity: 1, code: e.code, source: "fish", message: shown(e.message, e.names) }, related);
  const elsewhere = sourceOf(text, path, e.start, e.sources);
  const { line, col } = locate(elsewhere.src, Math.min(elsewhere.offset, elsewhere.src.length));
  if (at !== undefined) related.unshift({ location: at, message: shown(e.message, e.names) });
  return withRelated({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, severity: 1, code: e.code, source: "fish", message: `${elsewhere.file}:${line}:${col}: ${shown(e.message, e.names)}` }, related);
}

// A diagnostic with its related places, when it has any.
function withRelated(d: Diagnostic, related: Related[]): Diagnostic {
  let out = d;
  if (related.length > 0) out.relatedInformation = related;
  return out;
}

function before(a: Ref<Position>, b: Ref<Position>): boolean {
  return a.line < b.line || (a.line === b.line && a.character <= b.character);
}

// A type as its program's names read to the user.
function named(checked: Ref<Checked>, t: Type): string {
  return shown(written(checked.tables.typing.show(t), checked.tables.names), checked.tables.names);
}

// A hint after each fallible call and `await` in `text` within `range`, naming what it can throw.
// A generic body's definition and its instances share nodes, so a place is hinted once.
export function hints(checked: Ref<Checked>, text: string, range: Ref<Range>): Hint[] {
  let found = new Map<usize, Hint>();
  for (const instance of compiledOf(checked)) {
    for (const [at, raised] of instance.raises) {
      // Past the document's text is another file's.
      if (at.kind === "throw" || at.end > text.length || found.has(at.end)) continue;
      const place = position(text, at.end);
      if (!before(range.start, place) || !before(place, range.end)) continue;
      let hint: Hint = { position: place, label: `throws ${named(checked, raised.from)}`, paddingLeft: true };
      if (raised.wrapper !== undefined) hint.tooltip = `becomes '${named(checked, raised.to)}' through 'From'`;
      found.set(at.end, hint);
    }
  }
  const ends = [...found.keys()].sort((a, b) => (a as i64) - (b as i64));
  let out: Hint[] = [];
  for (const end of ends) out.push(found.get(end)!);
  return out;
}

// A message framed as LSP sends one.
function send(body: string) {
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function notify(method: string, params: string) {
  send(`{"jsonrpc":"2.0","method":${JSON.stringify(method)},"params":${params}}`);
}

// What a request gives: its result's JSON, or an error with its code.
type Reply = { result: string } | { code: i64; message: string };

// The server's state: the open documents' text, by URI, and the text each was last checked with,
// with the program when it checked cleanly. A change is checked once the input that has arrived is
// read, so a burst of edits read together is checked once.
class Server {
  shutdown: boolean;
  documents: Map<string, string>;
  results: Map<string, { text: string; checked?: Checked }>;
  changed: boolean;

  constructor() {
    this.shutdown = false;
    this.documents = new Map<string, string>();
    this.results = new Map<string, { text: string; checked?: Checked }>();
    this.changed = false;
  }

  exit(): never {
    return process.exit(this.shutdown ? 0 : 1);
  }

  // Checks the open document at `uri` and publishes what it found. Each check compiles within a
  // session of its own, since a check uses up the one it is given.
  check(this: Mut<this>, uri: string) {
    const text = this.documents.get(uri);
    if (text === undefined || !uri.startsWith("file:")) return;
    // An open file's unsaved text, and any other's on disk.
    let open = new Map<string, string>();
    for (const [u, t] of this.documents) if (u.startsWith("file:")) open.set(resolve(fileURLToPath(u)), t);
    this.results.set(uri, { text });
    try {
      const found = diagnose(cachedSession(), fileURLToPath(uri), text, (path) => open.get(resolve(path)));
      notify("textDocument/publishDiagnostics", JSON.stringify({ uri, diagnostics: found.diagnostics }));
      this.results.set(uri, { text, checked: found.checked });
    } catch (e) {
      notify("window/logMessage", JSON.stringify({ type: 1, message: `fishc couldn't check ${uri}: ${e instanceof Error ? e.message : String(e)}` }));
    }
  }

  // Checks every open document, since any may import the one that changed.
  settle(this: Mut<this>) {
    if (!this.changed) return;
    this.changed = false;
    const uris = [...this.documents.keys()];
    for (const uri of uris) this.check(uri);
  }

  /** @throws {Error} */
  notified(this: Mut<this>, method: string, params: Ref<Params>) {
    const uri = params.textDocument?.uri ?? "";
    if (method === "exit") this.exit();
    else if (method === "textDocument/didOpen") {
      this.documents.set(uri, params.textDocument?.text ?? "");
      this.changed = true;
    } else if (method === "textDocument/didChange") {
      const changes = params.contentChanges;
      if (changes === undefined || changes.length === 0) throw new Error("a change gave no contentChanges");
      this.documents.set(uri, changes[changes.length - 1]!.text);
      this.changed = true;
    } else if (method === "textDocument/didSave") this.changed = true;
    else if (method === "textDocument/didClose") {
      this.documents.delete(uri);
      this.results.delete(uri);
      const none: Diagnostic[] = [];
      notify("textDocument/publishDiagnostics", JSON.stringify({ uri, diagnostics: none }));
      // Its importers now read it from disk.
      this.changed = true;
    }
  }

  request(this: Mut<this>, method: string, params: Ref<Params>): Reply {
    if (method === "textDocument/inlayHint") {
      const uri = params.textDocument?.uri ?? "";
      // A hint asked for before the change was checked shouldn't wait for the next edit.
      if (this.results.get(uri)?.text !== this.documents.get(uri)) this.check(uri);
      const result = this.results.get(uri);
      const range = params.range;
      if (result === undefined || result.checked === undefined || range === undefined) return { result: "[]" };
      return { result: JSON.stringify(hints(result.checked, result.text, range)) };
    }
    if (method === "initialize") return { result: JSON.stringify({ capabilities: { textDocumentSync: 1, inlayHintProvider: true }, serverInfo: { name: "fishc" } }) };
    if (method === "shutdown") {
      this.shutdown = true;
      return { result: "null" };
    }
    return { code: -32601, message: `'${method}' isn't supported` };
  }

  receive(this: Mut<this>, body: string) {
    let message: Message | undefined = undefined;
    try {
      message = JSON.parse<Message>(body);
    } catch (e) {
      send(`{"jsonrpc":"2.0","id":null,"error":${JSON.stringify({ code: -32700, message: e instanceof Error ? e.message : String(e) })}}`);
      return;
    }
    const got = message!;
    const method = got.method;
    if (method === undefined) return;
    const none: Params = {};
    const params = got.params ?? none;
    if (got.id === undefined) {
      try {
        this.notified(method, params);
      } catch (e) {
        notify("window/logMessage", JSON.stringify({ type: 1, message: `fishc couldn't handle '${method}': ${e instanceof Error ? e.message : String(e)}` }));
      }
      return;
    }
    const id = JSON.stringify(got.id);
    let reply: Reply = { code: -32603, message: "the request wasn't answered" };
    try {
      reply = this.request(method, params);
    } catch (e) {
      reply = { code: -32603, message: e instanceof Error ? e.message : String(e) };
    }
    if ("result" in reply) send(`{"jsonrpc":"2.0","id":${id},"result":${reply.result}}`);
    else send(`{"jsonrpc":"2.0","id":${id},"error":${JSON.stringify({ code: reply.code, message: reply.message })}}`);
  }
}

// Serves the protocol over stdin and stdout until input ends or the client says to exit.
export async function serveLsp(): Promise<void> {
  let server = new Server();
  let pending: Buffer = Buffer.alloc(0);
  for await (const chunk of process.stdin) {
    const framed = frames(Buffer.concat([pending, chunk]));
    pending = framed.rest;
    for (const body of framed.bodies) server.receive(body);
    server.settle();
  }
  server.exit();
}

// The errors `e` stands for, each with its group's sources when it has none of its own, and the
// names its group's compilation made up.
export function errorsOf(e: CompileError): CompileError[] {
  if (e.errors.length === 0) return [e];
  let out = e.errors;
  for (let i: usize = 0; i < out.length; i++) {
    if (out[i]!.sources.length === 0) out[i]!.sources = [...e.sources];
    out[i]!.names = copyNames(e.names);
  }
  return out;
}
