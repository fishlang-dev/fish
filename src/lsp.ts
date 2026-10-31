// `fishc lsp`: the Language Server Protocol's JSON-RPC over stdin and stdout.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Checked } from "./check.ts";
import { shared } from "./compilation.ts";
import { CompileError, locate, shown, sourceOf, written, type Source } from "./diag.ts";
import { analyze } from "./main.ts";
import { STD_BASE } from "./std.ts";
import { show, type Type } from "./typing.ts";

type Message = { id?: number | string | null; method?: string; params?: Params };
// The parameters of the methods served, which all name a document.
type Params = { textDocument: { uri: string; text: string }; contentChanges: { text: string }[]; range: Range };

// The message bodies whole in `buffer`, and the bytes after them, which wait for more input.
// Each body follows headers ending in a blank line, with `Content-Length` its length in bytes.
export function frames(buffer: Buffer): { bodies: string[]; rest: Buffer } {
  const bodies: string[] = [];
  for (;;) {
    const end = buffer.indexOf("\r\n\r\n");
    if (end < 0) break;
    const length = /^content-length: *(\d+)/im.exec(buffer.subarray(0, end).toString("ascii"))?.[1];
    // Headers without a length can't say where the body ends; skip them.
    if (length === undefined) {
      buffer = buffer.subarray(end + 4);
      continue;
    }
    const start = end + 4;
    if (buffer.length < start + Number(length)) break;
    bodies.push(buffer.subarray(start, start + Number(length)).toString("utf8"));
    buffer = buffer.subarray(start + Number(length));
  }
  return { bodies, rest: buffer };
}

type Position = { line: number; character: number };
type Range = { start: Position; end: Position };
type Location = { uri: string; range: Range };

// LSP's positions count UTF-16 code units, as the compiler's offsets into a JavaScript string do.
function position(src: string, offset: number): Position {
  const { line, col } = locate(src, Math.min(offset, src.length));
  return { line: line - 1, character: col - 1 };
}

// Where a span of the program checked from `path` lies, in whichever of its files holds it; std
// has no file an editor can open.
function located(path: string, text: string, sources: Source[], start: number, end: number): Location | undefined {
  if (start >= STD_BASE) return undefined;
  const at = sourceOf(text, path, start, sources);
  const range = { start: position(at.src, at.offset), end: position(at.src, at.offset + (end - start)) };
  return { uri: pathToFileURL(resolve(dirname(path), at.file)).href, range };
}

// The diagnostics checking `text`, the document at `path`, gives, with its imports read by `read`,
// and the checked program when there are none. An error in another file shows at the document's
// start, saying where it is.
function diagnose(path: string, text: string, read: (path: string) => string): { diagnostics: object[]; checked?: Checked } {
  try {
    return { diagnostics: [], checked: analyze(text, path, read).checked };
  } catch (e) {
    if (!(e instanceof CompileError)) throw e;
    const uri = pathToFileURL(path).href;
    const at = located(path, text, e.sources, e.start, e.end);
    const note = e.note && located(path, text, e.sources, e.note.start, e.note.end);
    const related = [...(note ? [{ location: note, message: shown(e.note!.message, e.names) }] : [])];
    if (at?.uri === uri) return { diagnostics: [{ range: at.range, severity: 1, source: "fish", message: shown(e.message, e.names), ...(related.length > 0 && { relatedInformation: related }) }] };
    const elsewhere = sourceOf(text, path, e.start, e.sources);
    const { line, col } = locate(elsewhere.src, Math.min(elsewhere.offset, elsewhere.src.length));
    if (at) related.unshift({ location: at, message: shown(e.message, e.names) });
    const start = { line: 0, character: 0 };
    return { diagnostics: [{ range: { start, end: start }, severity: 1, source: "fish", message: `${elsewhere.file}:${line}:${col}: ${shown(e.message, e.names)}`, ...(related.length > 0 && { relatedInformation: related }) }] };
  }
}

const before = (a: Position, b: Position) => a.line < b.line || (a.line === b.line && a.character <= b.character);
const named = (t: Type) => shown(written(show(t), shared.names), shared.names);

// A hint after each fallible call and `await` in `text` within `range`, naming what it can throw.
// A generic body's definition and its instances share nodes, so a place is hinted once.
export function hints(checked: Checked, text: string, range: Range) {
  const found = new Map<number, object>();
  for (const instance of checked.instances) {
    for (const [at, raised] of instance.raises) {
      // Past the document's text is another file's.
      if (at.kind === "throw" || at.end > text.length || found.has(at.end)) continue;
      const place = position(text, at.end);
      if (!before(range.start, place) || !before(place, range.end)) continue;
      const tooltip = raised.wrapper && `becomes '${named(raised.to)}' through 'From'`;
      found.set(at.end, { position: place, label: `throws ${named(raised.from)}`, paddingLeft: true, ...(tooltip && { tooltip }) });
    }
  }
  return [...found].sort(([a], [b]) => a - b).map(([, hint]) => hint);
}

function send(message: object) {
  const body = JSON.stringify({ jsonrpc: "2.0", ...message });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

export function serveLsp() {
  let shutdown = false;
  const exit = () => process.exit(shutdown ? 0 : 1);
  const notify = (method: string, params: unknown) => send({ method, params });

  // The open documents' text, by URI.
  const documents = new Map<string, string>();
  // An open file's unsaved text, and any other's on disk.
  const read = (path: string) => {
    for (const [uri, text] of documents) if (uri.startsWith("file:") && resolve(fileURLToPath(uri)) === resolve(path)) return text;
    return readFileSync(path, "utf8");
  };
  // The text each document was last checked with, and the program when it checked cleanly.
  const results = new Map<string, { text: string; checked?: Checked }>();
  const check = (uri: string) => {
    const text = documents.get(uri);
    if (text === undefined || !uri.startsWith("file:")) return;
    results.set(uri, { text });
    try {
      const { diagnostics, checked } = diagnose(fileURLToPath(uri), text, read);
      results.set(uri, { text, checked });
      notify("textDocument/publishDiagnostics", { uri, diagnostics });
    } catch (e) {
      notify("window/logMessage", { type: 1, message: `fishc couldn't check ${uri}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}` });
    }
  };
  // Typing sends a change per keystroke; only the text it settles on is worth checking. Any open
  // document may import the one that changed, so every one is checked again.
  let timer: Timer | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => [...documents.keys()].forEach(check), 150);
  };

  const notified = (method: string, params: Params) => {
    const uri = params.textDocument?.uri;
    switch (method) {
      case "exit":
        return exit();
      case "textDocument/didOpen":
        documents.set(uri, params.textDocument.text);
        return schedule();
      case "textDocument/didChange":
        documents.set(uri, params.contentChanges.at(-1)!.text);
        return schedule();
      case "textDocument/didSave":
        return schedule();
      case "textDocument/didClose":
        documents.delete(uri);
        results.delete(uri);
        notify("textDocument/publishDiagnostics", { uri, diagnostics: [] });
        // Its importers now read it from disk.
        return schedule();
    }
  };

  const request = (method: string, params: Params): unknown => {
    switch (method) {
      case "textDocument/inlayHint": {
        const { uri } = params.textDocument;
        // A hint asked for before the debounced check ran shouldn't wait for the next edit.
        if (results.get(uri)?.text !== documents.get(uri)) check(uri);
        const result = results.get(uri);
        return result?.checked ? hints(result.checked, result.text, params.range) : [];
      }
      case "initialize":
        return { capabilities: { textDocumentSync: 1, inlayHintProvider: true }, serverInfo: { name: "fishc" } };
      case "shutdown":
        shutdown = true;
        return null;
    }
    throw { code: -32601, message: `'${method}' isn't supported` };
  };

  const receive = (body: string) => {
    let message: Message;
    try {
      message = JSON.parse(body);
    } catch (e) {
      return send({ id: null, error: { code: -32700, message: e instanceof Error ? e.message : String(e) } });
    }
    if (typeof message.method !== "string") return;
    if (message.id === undefined) {
      try {
        notified(message.method, message.params ?? ({} as Params));
      } catch (e) {
        notify("window/logMessage", { type: 1, message: `fishc couldn't handle '${message.method}': ${e instanceof Error ? e.message : String(e)}` });
      }
      return;
    }
    try {
      send({ id: message.id, result: request(message.method, message.params ?? ({} as Params)) });
    } catch (e) {
      send({ id: message.id, error: typeof e === "object" && e !== null && "code" in e ? e : { code: -32603, message: e instanceof Error ? e.message : String(e) } });
    }
  };

  let pending: Buffer = Buffer.alloc(0);
  process.stdin.on("data", (chunk: Buffer) => {
    const { bodies, rest } = frames(Buffer.concat([pending, chunk]));
    pending = rest;
    bodies.forEach(receive);
  });
  process.stdin.on("end", exit);
}
