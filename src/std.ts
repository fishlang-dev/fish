import { parse, shiftSpans, type Stmt } from "./parser.ts";

// Fish's std library, as Fish source checked with each program. The prelude goes into every
// program; the HTTP library only into one that names it.

const PRELUDE = `
type TemplateStringsArray = string[];
function* __arrayEntries<T>(xs: Ref<T[]>): Generator<[i64, T]> {
  let i = 0;
  for (const x of xs) {
    yield [i, x.clone()];
    i++;
  }
}
function* __arrayKeys<T>(xs: Ref<T[]>): Generator<i64> {
  for (let i = 0; i < (xs.length as i64); i++) yield i;
}
function* __arrayValues<T>(xs: Ref<T[]>): Generator<T> {
  for (const x of xs) yield x.clone();
}
class AbortError { message: string = "This operation was aborted"; }
class IoError { message: string; constructor(message: string) { this.message = message; } }
class TextEncoder { encode(input: string): u8[] { return utf8Encode(input); } }
class TextDecoder { decode(input: Ref<u8[]>): string { return utf8Decode(input); } }
`;

// The Fetch API's Headers, Request and Response.
const HTTP = `
class Headers {
  names: string[] = [];
  values: string[] = [];

  get(name: string): string | null {
    const key = name.toLowerCase();
    let found = "";
    let any = false;
    for (let i = 0; i < this.names.length; i++) {
      if (this.names[i] === key) {
        found = any ? found + ", " + this.values[i] : this.values[i];
        any = true;
      }
    }
    if (any) return found;
    return null;
  }

  has(name: string): boolean {
    const key = name.toLowerCase();
    for (let i = 0; i < this.names.length; i++) {
      if (this.names[i] === key) return true;
    }
    return false;
  }

  set(this: Mut<this>, name: string, value: string) {
    this.delete(name);
    this.append(name, value);
  }

  append(this: Mut<this>, name: string, value: string) {
    this.names.push(name.toLowerCase());
    this.values.push(value);
  }

  delete(this: Mut<this>, name: string) {
    const key = name.toLowerCase();
    let names: string[] = [];
    let values: string[] = [];
    for (let i = 0; i < this.names.length; i++) {
      if (this.names[i] !== key) {
        names.push(this.names[i]);
        values.push(this.values[i]);
      }
    }
    this.names = names;
    this.values = values;
  }

  forEach(callback: (value: string, name: string) => void) {
    for (let i = 0; i < this.names.length; i++) callback(this.values[i], this.names[i]);
  }
}

type RequestInit = { method?: string; headers?: Headers; body?: string; signal?: AbortSignal };

class Request {
  method: string;
  url: string;
  path: string;
  headers: Headers;
  body: string;
  signal: AbortSignal;
  // The :params a Router's route took from the path, as name then value.
  params: string[] = [];

  constructor(url: string, init?: RequestInit) {
    this.url = url;
    this.path = Http1.pathOf(url);
    let method = "GET";
    let headers = new Headers();
    let body = "";
    let signal = new AbortController().signal;
    if (init !== null) {
      const m = init.method;
      if (m !== null) method = m.toUpperCase();
      const h = init.headers;
      if (h !== null) headers = h;
      const b = init.body;
      if (b !== null) body = b;
      const s = init.signal;
      if (s !== null) signal = s;
    }
    this.method = method;
    this.headers = headers;
    this.body = body;
    this.signal = signal;
  }

  async text(): Promise<string> {
    return this.body;
  }

  // The path segment a Router's ':name' matched, the last when the name repeats, or "" when its
  // route has no such parameter.
  param(name: string): string {
    let found = "";
    for (let i: usize = 0; i + 1 < this.params.length; i += 2) {
      if (this.params[i] === name) found = this.params[i + 1];
    }
    return found;
  }
}

type ResponseInit = { status?: i64; statusText?: string; headers?: Headers };

class Response {
  status: i64;
  statusText: string;
  headers: Headers;
  body: string;

  constructor(body?: string | null, init?: ResponseInit) {
    let status: i64 = 200;
    let statusText = "";
    let headers = new Headers();
    if (init !== null) {
      const s = init.status;
      if (s !== null) status = s;
      const t = init.statusText;
      if (t !== null) statusText = t;
      const h = init.headers;
      if (h !== null) headers = h;
    }
    let text = "";
    if (body !== null) {
      text = body;
      if (!headers.has("content-type")) headers.set("content-type", "text/plain;charset=UTF-8");
    }
    this.status = status;
    this.statusText = statusText;
    this.headers = headers;
    this.body = text;
  }

  get ok(): boolean {
    return this.status >= 200 && this.status < 300;
  }

  async text(): Promise<string> {
    return this.body;
  }
}

type ServeInfo = { hostname: string; port: i64 };
type ServeOptions = { port?: i64; hostname?: string; signal?: AbortSignal; onListen?: (info: ServeInfo) => void };
type ServeHandler = (req: Request) => Promise<Response>;

// Serves HTTP/1.1 on hostname and port, each connection on a task of its own.
async function serve(options: ServeOptions, handler: (req: Request) => Promise<Response>): Promise<void> throws IoError {
  let hostname = "0.0.0.0";
  const h = options.hostname;
  if (h !== null) hostname = h;
  let port: i64 = 8000;
  const p = options.port;
  if (p !== null) port = p;
  let stop = new AbortController().signal;
  const given = options.signal;
  if (given !== null) stop = given;
  const live = shared({ count: new Atomic(0) });
  {
    // The listener closes as this block ends, so no one new waits while connections drain.
    const listener = await TcpListener.bind(hostname, port);
    const bound = listener.port;
    const listen = options.onListen;
    if (listen !== null) listen({ hostname: hostname, port: bound });
    const boxed: ServeHandler = handler;
    const host = hostname + ":" + String(bound);
    while (true) {
      try {
        const conn = await listener.accept(stop);
        live.count.add(1);
        spawn(Http1.tracked(conn, boxed.clone(), host, stop.clone(), live.clone()));
      } catch (e) {
        if (e instanceof AbortError) break;
        // Out of file descriptors, say: those in use free up as connections end.
        await sleep(50);
      }
    }
  }
  // ponytail: polls until the last connection ends; a wait group would wake at once.
  while (live.count.load() > 0) await sleep(10);
}

// What a request's head says: its request line and headers.
class HttpHead {
  method: string;
  target: string;
  version: string;
  headers: Headers;
  constructor(method: string, target: string, version: string, headers: Headers) {
    this.method = method;
    this.target = target;
    this.version = version;
    this.headers = headers;
  }
}

// One connection's requests, one after another while both sides keep it open. Waiting for a
// request ends after 5 seconds; once one starts, it has 30 seconds to arrive whole.
async function serveConnection(conn: TcpStream, handler: ServeHandler, host: string, stop: AbortSignal): Promise<void> {
  let buffer: u8[] = [];
  try {
    while (true) {
      buffer = Http1.skipBlank(buffer);
      let started = buffer.length > 0;
      let deadline = nowMs() + (started ? 30000 : 5000);
      let end = Http1.headEnd(buffer, 0);
      while (end < 0) {
        // A head may take 16 KiB, and a body 1 MiB.
        if ((buffer.length as i64) > 16384) { await Http1.refuse(conn, 431); return; }
        const got = await Http1.readBy(conn, stop, deadline);
        if (got.length === 0) return;
        if (!started) {
          started = true;
          deadline = nowMs() + 30000;
        }
        const from = buffer.length as i64 - 3;
        for (const b of got) buffer.push(b);
        buffer = Http1.skipBlank(buffer);
        end = Http1.headEnd(buffer, from < 0 ? 0 : from);
      }
      if (end > 16384) { await Http1.refuse(conn, 431); return; }
      const head = Http1.parseHead(new TextDecoder().decode(Http1.take(buffer, 0, end)));
      if (head === null) { await Http1.refuse(conn, 400); return; }
      buffer = Http1.take(buffer, end + 4, buffer.length as i64);
      if (head.headers.has("transfer-encoding")) { await Http1.refuse(conn, 501); return; }
      const length = Http1.contentLength(head.headers);
      if (length < 0) { await Http1.refuse(conn, 400); return; }
      if (length > 1048576) { await Http1.refuse(conn, 413); return; }
      // The Host header names the server and nothing else, and HTTP/1.1 requires one.
      let authority = host;
      const named = head.headers.get("host");
      if (named !== null) authority = named;
      if ((named === null && head.version === "HTTP/1.1") || !Http1.isHost(authority)) { await Http1.refuse(conn, 400); return; }
      const expect = head.headers.get("expect");
      if (length > 0 && head.version === "HTTP/1.1" && expect !== null && expect.toLowerCase() === "100-continue") {
        await conn.write(new TextEncoder().encode("HTTP/1.1 100 Continue\\r\\n\\r\\n"), AbortSignal.timeout(30000));
      }
      while ((buffer.length as i64) < length) {
        const got = await Http1.readBy(conn, stop, deadline);
        if (got.length === 0) return;
        for (const b of got) buffer.push(b);
      }
      const body = new TextDecoder().decode(Http1.take(buffer, 0, length));
      buffer = Http1.take(buffer, length, buffer.length as i64);
      const keep = Http1.keepAlive(head);
      const method = head.method;
      const version = head.version;
      // While the handler runs, a watcher aborts the request's signal if the client goes away.
      const client = new AbortController();
      const signal = client.signal;
      const done = new AbortController();
      const watching = spawn(Http1.watch(conn.clone(), client, done.signal));
      const req = new Request("http://" + authority + head.target, { method: method, headers: head.headers, body: body, signal: signal });
      const res = await handler(req);
      done.abort();
      const early = await watching;
      for (const b of early) buffer.push(b);
      const said = res.headers.get("connection");
      const close = !keep || stop.aborted || (said !== null && Http1.hasToken(said, "close"));
      // A response that can't be sent as it stands, like a header value holding a line break,
      // goes out as a 500 instead.
      const text = Http1.sendable(res) ? Http1.responseText(res, method === "HEAD", close, version) : Http1.responseText(new Response("Internal Server Error\\n", { status: 500 }), false, close, version);
      await conn.write(new TextEncoder().encode(text), AbortSignal.timeout(30000));
      if (close) return;
    }
  } catch (e) {
    return;
  }
}

// Routes requests by method and path, as Hono and Express do: the first route matching both
// runs, ':name' segments match any one segment, and a request no route matches gets a 404.
// ponytail: each request walks every route in order; a tree of segments would scale further.
class Router {
  methods: string[] = [];
  routes: string[][] = [];
  handlers: ServeHandler[] = [];

  get(this: Mut<this>, path: string, handler: ServeHandler) { this.route("GET", path, handler); }
  post(this: Mut<this>, path: string, handler: ServeHandler) { this.route("POST", path, handler); }
  put(this: Mut<this>, path: string, handler: ServeHandler) { this.route("PUT", path, handler); }
  patch(this: Mut<this>, path: string, handler: ServeHandler) { this.route("PATCH", path, handler); }
  delete(this: Mut<this>, path: string, handler: ServeHandler) { this.route("DELETE", path, handler); }
  // A route for every method.
  all(this: Mut<this>, path: string, handler: ServeHandler) { this.route("", path, handler); }

  // A route for a method, in any case; a path without a leading '/' gets one.
  route(this: Mut<this>, method: string, path: string, handler: ServeHandler) {
    this.methods.push(method.toUpperCase());
    this.routes.push((path.startsWith("/") ? path : "/" + path).split("/"));
    this.handlers.push(handler);
  }

  // The first matching route's response; a HEAD request may run a GET route.
  async handle(req: Request): Promise<Response> {
    const have = req.path.split("/");
    const head = req.method === "HEAD";
    for (let i = 0; i < this.routes.length; i++) {
      const method = this.methods[i];
      if (method !== "" && method !== req.method && !(head && method === "GET")) continue;
      const found = Router.match(this.routes[i], have);
      if (found === null) continue;
      let routed = req;
      routed.params = found;
      const res = await this.handlers[i](routed);
      return res;
    }
    return new Response("Not Found\\n", { status: 404 });
  }

  // The router as the handler serve takes; the handler owns it.
  handler(this: Own<this>): ServeHandler {
    const router = this;
    return async (req: Request) => {
      const res = await router.handle(req);
      return res;
    };
  }

  // The :params a route's segments take from a path's, or null when they don't match.
  static match(want: Ref<string[]>, have: Ref<string[]>): string[] | null {
    if (want.length !== have.length) return null;
    let params: string[] = [];
    for (let i = 0; i < want.length; i++) {
      if (want[i].startsWith(":")) {
        if (have[i].length === 0) return null;
        params.push(want[i].slice(1));
        params.push(have[i]);
      } else if (want[i] !== have[i]) return null;
    }
    return params;
  }
}

// The wire format of HTTP/1.x.
class Http1 {
  // A connection's requests, counted while it is open so the server can wait for it at shutdown.
  static async tracked(conn: TcpStream, handler: ServeHandler, host: string, stop: AbortSignal, live: shared<{ count: Atomic<i64> }>): Promise<void> {
    await serveConnection(conn, handler, host, stop);
    live.count.sub(1);
  }

  // The client's next bytes, or nothing once the deadline passes or the server stops.
  // ponytail: wakes every 250 ms to look at the server's signal; AbortSignal.any would combine them.
  static async readBy(conn: Ref<TcpStream>, stop: Ref<AbortSignal>, deadline: i64): Promise<u8[]> throws IoError {
    while (!stop.aborted) {
      const left = deadline - nowMs();
      if (left <= 0) return [];
      try {
        const got = await conn.read(16384, AbortSignal.timeout(left < 250 ? left : 250));
        return got;
      } catch (e) {
        if (e instanceof IoError) throw e;
      }
    }
    return [];
  }

  // Reads from the client while its request is handled: the end of the stream, or a broken
  // connection, aborts the request's signal. Bytes that arrive are handed back for the next request.
  static async watch(conn: TcpStream, client: AbortController, done: AbortSignal): Promise<u8[]> {
    try {
      const got = await conn.read(16384, done);
      if (got.length === 0) client.abort();
      return got;
    } catch (e) {
      if (e instanceof IoError) client.abort();
      return [];
    }
  }

  // Answers a request the server won't serve, and ends the connection.
  static async refuse(conn: Ref<TcpStream>, status: i64): Promise<void> throws IoError | AbortError {
    const res = new Response(Http1.reasonPhrase(status) + "\\n", { status: status });
    await conn.write(new TextEncoder().encode(Http1.responseText(res, false, true, "HTTP/1.1")), AbortSignal.timeout(30000));
  }

  // A URL's path: after the scheme and host, up to its query or fragment.
  static pathOf(url: string): string {
    let start = 0;
    const scheme = url.indexOf("://");
    if (scheme >= 0) {
      const slash = url.indexOf("/", scheme + 3);
      if (slash < 0) return "/";
      start = slash;
    }
    let end = url.length as i64;
    const query = url.indexOf("?", start);
    if (query >= 0) end = query;
    const hash = url.indexOf("#", start);
    if (hash >= 0 && hash < end) end = hash;
    const path = url.slice(start, end);
    if (path.length === 0) return "/";
    return path;
  }

  // Where a request's head ends: the index of its blank line's CR LF CR LF, or -1. The search
  // starts at from, since what was searched before held no end.
  static headEnd(buffer: Ref<u8[]>, from: i64): i64 {
    for (let i = from as usize; i + 3 < buffer.length; i++) {
      if (buffer[i] === 13 && buffer[i + 1] === 10 && buffer[i + 2] === 13 && buffer[i + 3] === 10) return i as i64;
    }
    return -1;
  }

  // Drops empty lines before a request, which a client may send after a body.
  static skipBlank(buffer: u8[]): u8[] {
    let at: i64 = 0;
    while ((buffer.length as i64) >= at + 2 && buffer[at as usize] === 13 && buffer[(at + 1) as usize] === 10) at += 2;
    if (at === 0) return buffer;
    return Http1.take(buffer, at, buffer.length as i64);
  }

  // The bytes from start to end, as a new array.
  // ponytail: copies byte by byte; array slicing would save a 1 MiB body two or three copies.
  static take(buffer: Ref<u8[]>, start: i64, end: i64): u8[] {
    let out: u8[] = [];
    for (let i = start as usize; i < (end as usize); i++) out.push(buffer[i]);
    return out;
  }

  // The request line and headers, or null when they aren't HTTP/1.x.
  static parseHead(text: string): HttpHead | null {
    const lines = text.split("\\r\\n");
    // A CR, LF or NUL left after splitting at CR LF is a line break some other server sees.
    if (Http1.hasBreak(lines[0])) return null;
    const parts = lines[0].split(" ");
    if (parts.length !== 3 || !Http1.isToken(parts[0]) || !parts[1].startsWith("/")) return null;
    const version = parts[2];
    if (version !== "HTTP/1.1" && version !== "HTTP/1.0") return null;
    let headers = new Headers();
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const colon = line.indexOf(":");
      if (colon <= 0 || Http1.hasBreak(line)) return null;
      const name = line.slice(0, colon);
      if (!Http1.isToken(name)) return null;
      headers.append(name, line.slice(colon + 1).trim());
    }
    return new HttpHead(parts[0], parts[1], version, headers);
  }

  // The body's length from Content-Length, 0 without one, or -1 when it isn't a number.
  static contentLength(headers: Ref<Headers>): i64 {
    const text = headers.get("content-length");
    if (text === null) return 0;
    return Http1.digits(text);
  }

  // A whole number written in decimal digits, or -1.
  static digits(text: string): i64 {
    if (text.length === 0 || text.length > 15) return -1;
    let n: i64 = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i) as i64;
      if (c < 48 || c > 57) return -1;
      n = n * 10 + (c - 48);
    }
    return n;
  }

  // HTTP/1.1 keeps a connection open unless asked not to; HTTP/1.0 closes it unless asked to keep it.
  static keepAlive(head: Ref<HttpHead>): boolean {
    const asked = head.headers.get("connection");
    const said = asked === null ? "" : asked;
    if (head.version === "HTTP/1.0") return Http1.hasToken(said, "keep-alive");
    return !Http1.hasToken(said, "close");
  }

  // Whether a comma-separated header value lists a token, in any case.
  static hasToken(value: string, token: string): boolean {
    for (const part of value.split(",")) {
      if (part.trim().toLowerCase() === token) return true;
    }
    return false;
  }

  // Whether text is an HTTP token: one or more letters, digits or !#$%&'*+-.^_\`|~.
  static isToken(text: string): boolean {
    if (text.length === 0) return false;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i) as i64;
      const alnum = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
      const mark = c === 33 || (c >= 35 && c <= 39) || c === 42 || c === 43 || c === 45 || c === 46 || c === 94 || c === 95 || c === 96 || c === 124 || c === 126;
      if (!alnum && !mark) return false;
    }
    return true;
  }

  // Whether text holds a CR, LF or NUL.
  static hasBreak(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i) as i64;
      if (c === 13 || c === 10 || c === 0) return true;
    }
    return false;
  }

  // Whether a Host header names a host and port only: no path, query, fragment, user, space,
  // or list of hosts.
  static isHost(text: string): boolean {
    if (text.length === 0) return false;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i) as i64;
      if (c <= 32 || c === 47 || c === 63 || c === 35 || c === 64 || c === 44 || c === 92 || c === 127) return false;
    }
    return true;
  }

  // Whether a response can go out as it stands: a status the Fetch API allows, and a status
  // text and headers that can't break into lines of their own.
  static sendable(res: Ref<Response>): boolean {
    if (res.status < 200 || res.status > 599 || Http1.hasBreak(res.statusText)) return false;
    let fine = true;
    res.headers.forEach((value: string, name: string) => {
      if (!Http1.isToken(name) || Http1.hasBreak(value)) fine = false;
    });
    return fine;
  }

  // A response's status line, headers and body, as sent.
  // The server frames the body itself, so a handler's own framing headers are left out; 204
  // and 304 have no body at all.
  static responseText(res: Ref<Response>, head: boolean, close: boolean, version: string): string {
    let reason = res.statusText;
    if (reason.length === 0) reason = Http1.reasonPhrase(res.status);
    let text = "HTTP/1.1 " + String(res.status) + " " + reason + "\\r\\n";
    res.headers.forEach((value: string, name: string) => {
      if (name !== "content-length" && name !== "transfer-encoding" && name !== "connection" && name !== "date") text = text + name + ": " + value + "\\r\\n";
    });
    const bodiless = res.status === 204 || res.status === 304;
    if (!bodiless) {
      const size = new TextEncoder().encode(res.body).length;
      text = text + "content-length: " + String(size as i64) + "\\r\\n";
    }
    text = text + "date: " + httpDate() + "\\r\\n";
    if (close) text = text + "connection: close\\r\\n";
    else if (version === "HTTP/1.0") text = text + "connection: keep-alive\\r\\n";
    text = text + "\\r\\n";
    if (!head && !bodiless) text = text + res.body;
    return text;
  }

  static reasonPhrase(status: i64): string {
    return match (status) {
      case 200 => "OK",
      case 201 => "Created",
      case 202 => "Accepted",
      case 204 => "No Content",
      case 301 => "Moved Permanently",
      case 302 => "Found",
      case 304 => "Not Modified",
      case 400 => "Bad Request",
      case 401 => "Unauthorized",
      case 403 => "Forbidden",
      case 404 => "Not Found",
      case 405 => "Method Not Allowed",
      case 413 => "Content Too Large",
      case 431 => "Request Header Fields Too Large",
      case 500 => "Internal Server Error",
      case 501 => "Not Implemented",
      case 503 => "Service Unavailable",
      case _ => "",
    };
  }
}
`;

const HTTP_NAMES = ["serve", "Router", "Request", "Response", "Headers", "ServeOptions", "ServeInfo", "ServeHandler", "RequestInit", "ResponseInit"];

// The std source sits past every program's files in offsets, so a position says which it is in.
export const STD_BASE = 2 ** 40;
export const STD_SOURCE = PRELUDE + HTTP;
export const STD_FILE = "<fish std>";

// The std statements a program is checked with, their spans moved past its own.
export function stdFor(written: Stmt[]): Stmt[] {
  const all = parse(STD_SOURCE);
  shiftSpans(all, STD_BASE);
  const prelude = all.filter((s) => s.start - STD_BASE < PRELUDE.length);
  const http = all.filter((s) => s.start - STD_BASE >= PRELUDE.length);
  return usesHttp(written, http) ? all : prelude;
}

// A program that refers to the HTTP library by name gets it, unless it declares one of the
// library's top-level names itself.
function usesHttp(written: Stmt[], http: Stmt[]): boolean {
  const declared = new Set(written.map((s) => ("name" in s ? s.name : undefined)));
  if (http.some((s) => "name" in s && declared.has(s.name))) return false;
  const names = (v: unknown): boolean => {
    if (Array.isArray(v)) return v.some(names);
    if (typeof v !== "object" || v === null) return false;
    const node = v as Record<string, unknown>;
    const named = (node.kind === "ident" || node.kind === "ref") && typeof node.name === "string" && HTTP_NAMES.includes(node.name);
    return named || Object.values(node).some(names);
  };
  return names(written);
}
