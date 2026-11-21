// `fishc lsp`: the Language Server Protocol's JSON-RPC over stdin and stdout.
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Checked } from "./check.fsh";
import { compiledOf } from "./codegen.fsh";
import { type Session } from "./compilation.fsh";
import { type Kept } from "./incremental.fsh";
import { Queries } from "./queries.fsh";
import { cachedSession } from "./stdcache.fsh";
import { CompileError, copyNames, locate, shown, sourceOf, written, type Source } from "./diag.fsh";
import { STD_BASE } from "./std.fsh";
import type { Type } from "./typing.fsh";

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
    const length = /^content-length: *(\d+)/im.exec(new TextDecoder().decode(buffer.slice(at as i64, end)));
    // Headers without a length can't say where the body ends; skip them.
    if (length === null) {
      at = start;
      continue;
    }
    const size = (Number(length[1]!) ?? 0) as usize;
    if (buffer.length < start + size) break;
    bodies.push(new TextDecoder().decode(buffer.slice(start as i64, (start + size) as i64)));
    at = start + size;
  }
  return { bodies, rest: buffer.slice(at as i64) };
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

// The diagnostics checking `text`, the document at `path`, gives, with its imports read from the
// open documents, by path, before the disk, and the check itself when there are none, with its
// warnings in this document. An error in another file shows at the document's start, saying where
// it is. `kept` is the last check of this document, which an edit rechecks only the changed bodies
// of; a check that fails gives nothing back, so the next one starts afresh.
/** @throws {Error | IoError} */
export function diagnose(session: Session, path: string, text: string, open: Map<string, string>, kept: Kept | undefined): { diagnostics: Diagnostic[]; kept?: Kept } {
  let queries = new Queries(path, undefined, open, true);
  let looked: string[] = [];
  try {
    let made = queries.checked(session, looked, kept);
    const uri = pathToFileURL(path).href;
    let warnings: Diagnostic[] = [];
    for (const w of made.checked.warnings) {
      const at = located(path, text, made.loaded.sources, w.start, w.end);
      if (at !== undefined && at.uri === uri) warnings.push({ range: at.range, severity: 2, code: w.code, source: "fish", message: shown(w.message, w.names) });
    }
    return { diagnostics: warnings, kept: made };
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
  if (e.note !== undefined) {
    const there = located(path, text, e.sources, e.note.start, e.note.end);
    if (there !== undefined) related.push({ location: there, message: shown(e.note.message, e.names) });
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
    for (const [at, raised] of instance.raises.entries()) {
      // Past the document's text is another file's.
      if (at.kind === "throw" || at.end > text.length || found.has(at.end)) continue;
      const place = position(text, at.end);
      if (!before(range.start, place) || !before(place, range.end)) continue;
      let hint: Hint = { position: place, label: `throws ${named(checked, raised.from)}`, paddingLeft: true };
      if (raised.wrapper !== undefined) hint.tooltip = `becomes '${named(checked, raised.to)}' through 'From'`;
      found.set(at.end, hint);
    }
  }
  let ends = [...found.keys()];
  ends.sort((a, b) => (a as i64) - (b as i64));
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

// The document last checked cleanly: which one, the text it was checked with, and the check
// itself, which the next check of the same document starts from.
type Held = { uri: string; text: string; kept: Kept };

// The server's state: the open documents' text, by URI, and the last clean check of one of them.
// A change is checked once the input that has arrived is read, so a burst of edits read together
// is checked once, and that check starts from the one before it.
// `held` holds at most one, in an array because a check is an owned value a method has to take out
// and put back. ponytail: one document's check, not one each; a table when editing two programs at
// once proves to cost.
class Server {
  shutdown: boolean;
  documents: Map<string, string>;
  held: Held[];
  changed: boolean;

  constructor() {
    this.shutdown = false;
    this.documents = new Map<string, string>();
    this.held = [];
    this.changed = false;
  }

  exit(): never {
    return process.exit(this.shutdown ? 0 : 1);
  }

  // Checks the open document at `uri` and publishes what it found. Each check compiles within a
  // session of its own, since a check uses up the one it is given, and starts from the last check
  // of this document when there is one.
  check(this: Mut<this>, uri: string) {
    const text = this.documents.get(uri);
    if (text === undefined || !uri.startsWith("file:")) return;
    const now = text!;
    // Another document's check can't stand in for this one's, so it is dropped rather than kept.
    let kept: Kept | undefined = undefined;
    if (this.held.length > 0) {
      let was = this.held.shift()!;
      if (was.uri === uri) kept = was.kept;
    }
    try {
      // An open file's unsaved text, and any other's on disk.
      let open = new Map<string, string>();
      for (const [u, t] of this.documents) if (u.startsWith("file:")) open.set(resolve(fileURLToPath(u)), t);
      const found = diagnose(cachedSession(), fileURLToPath(uri), now, open, kept);
      notify("textDocument/publishDiagnostics", JSON.stringify({ uri, diagnostics: found.diagnostics }));
      if (found.kept !== undefined) this.held = [{ uri, text: now, kept: found.kept! }];
    } catch (e) {
      notify("window/logMessage", JSON.stringify({ type: 1, message: `fishc couldn't check ${uri}: ${(e as { message: string }).message}` }));
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
      const changes: Ref<{ text: string }[] | undefined> = params.contentChanges;
      if (changes === undefined || changes.length === 0) throw new Error("a change gave no contentChanges");
      this.documents.set(uri, changes[changes.length - 1]!.text);
      this.changed = true;
    } else if (method === "textDocument/didSave") this.changed = true;
    else if (method === "textDocument/didClose") {
      this.documents.delete(uri);
      if (this.held.length > 0 && this.held[0]!.uri === uri) this.held = [];
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
      const written = this.documents.get(uri);
      const checked = this.held.length > 0 && this.held[0]!.uri === uri && written !== undefined && this.held[0]!.text === written!;
      if (!checked) this.check(uri);
      const range: Ref<Range | undefined> = params.range;
      if (this.held.length === 0 || this.held[0]!.uri !== uri || range === undefined) return { result: "[]" };
      return { result: JSON.stringify(hints(this.held[0]!.kept.checked, this.held[0]!.text, range)) };
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
      send(`{"jsonrpc":"2.0","id":null,"error":${JSON.stringify({ code: -32700, message: (e as { message: string }).message })}}`);
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
        notify("window/logMessage", JSON.stringify({ type: 1, message: `fishc couldn't handle '${method}': ${(e as { message: string }).message}` }));
      }
      return;
    }
    const id = JSON.stringify(got.id);
    const reply = this.request(method, params);
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
