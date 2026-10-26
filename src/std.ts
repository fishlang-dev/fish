import { AST } from "./ast.ts";
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
function __arrayChars(s: string): string[] {
  let out: string[] = [];
  for (const c of s) out.push(c);
  return out;
}
function __arrayCollect<T>(g: Generator<T>): T[] {
  let out: T[] = [];
  for (const x of g) out.push(x);
  return out;
}
function __arrayRange(n: i64): i64[] {
  let out: i64[] = [];
  for (let i = 0; i < n; i++) out.push(i);
  return out;
}
function __arrayFilled<T>(n: i64, x: T): T[] {
  let out: T[] = [];
  if (n === 0) return out;
  out.reserve(n);
  for (let i = 1; i < n; i++) out.push(x.clone());
  out.push(x);
  return out;
}
class AbortError { message: string = "This operation was aborted"; }
class IoError {
  message: string;
  code: string = "";
  syscall: string = "";
  path: string | null = null;
  constructor(message: string) { this.message = message; }
}
class JsonError { message: string; constructor(message: string) { this.message = message; } }
interface ErrorLike { name: string; message: string; }
type ErrorOptions = { cause?: Dyn<ErrorLike> };
class Error {
  name: string = "Error";
  message: string;
  cause: Dyn<ErrorLike> | null = null;
  constructor(message?: string, options?: ErrorOptions) {
    this.message = message ?? "";
    this.cause = options?.cause ?? null;
  }
}
// Error's fields of its own, printing as an Error does, until a generic class can extend one.
class AggregateError<E> {
  name: string = "AggregateError";
  message: string = "All promises were rejected";
  cause: Dyn<ErrorLike> | null = null;
  errors: E[];
  constructor(errors: E[]) { this.errors = errors; }
}
// new Promise(executor): the executor runs now, given callables that settle a one-value cell,
// which the promise awaits. The first settle closes the cell, so a later one is dropped. A cell
// never settled is never closed, so its promise waits forever, as JavaScript's does.
function __promiseCell<T, E>(executor: (resolve: (value: T) => void, reject: (reason: E) => void) => void): Channel<{ ok: true; value: T } | { ok: false; reason: E }> {
  const cell = new Channel<{ ok: true; value: T } | { ok: false; reason: E }>(1);
  const resolved = cell.clone();
  const rejected = cell.clone();
  executor((value) => { resolved.settle({ ok: true, value }); }, (reason) => { rejected.settle({ ok: false, reason }); });
  return cell;
}
async function __promiseAwait<T, E>(cell: Channel<{ ok: true; value: T } | { ok: false; reason: E }>): Promise<T> throws E {
  // Never empty: the cell closes holding its value.
  while (true) {
    const got = await cell.receive();
    if (got !== null) {
      if (got.ok === true) return got.value;
      throw got.reason;
    }
  }
}
function __promiseCellVoid<E>(executor: (resolve: () => void, reject: (reason: E) => void) => void): Channel<{ ok: true } | { ok: false; reason: E }> {
  const cell = new Channel<{ ok: true } | { ok: false; reason: E }>(1);
  const resolved = cell.clone();
  const rejected = cell.clone();
  executor(() => { resolved.settle({ ok: true }); }, (reason) => { rejected.settle({ ok: false, reason }); });
  return cell;
}
async function __promiseAwaitVoid<E>(cell: Channel<{ ok: true } | { ok: false; reason: E }>): Promise<void> throws E {
  while (true) {
    const got = await cell.receive();
    if (got !== null) {
      if (got.ok === true) return;
      throw got.reason;
    }
  }
}
// One whose executor takes no reject can't fail, so it may be stored as a Promise<T>.
// The value is wrapped, as a Channel can't carry an Option.
function __promiseCellResolve<T>(executor: (resolve: (value: T) => void) => void): Channel<{ value: T }> {
  const cell = new Channel<{ value: T }>(1);
  const resolved = cell.clone();
  executor((value) => { resolved.settle({ value }); });
  return cell;
}
async function __promiseAwaitResolve<T>(cell: Channel<{ value: T }>): Promise<T> {
  while (true) {
    const got = await cell.receive();
    if (got !== null) return got.value;
  }
}
function __promiseCellResolveVoid(executor: (resolve: () => void) => void): Channel<boolean> {
  const cell = new Channel<boolean>(1);
  const resolved = cell.clone();
  executor(() => { resolved.settle(true); });
  return cell;
}
async function __promiseAwaitResolveVoid(cell: Channel<boolean>): Promise<void> {
  while (true) {
    const got = await cell.receive();
    if (got !== null) return;
  }
}
// Promise.withResolvers(): the cell, the promise awaiting it and the closures settling it.
function __promiseWithResolvers<T, E>() {
  const cell = new Channel<{ ok: true; value: T } | { ok: false; reason: E }>(1);
  const resolved = cell.clone();
  const rejected = cell.clone();
  return {
    promise: __promiseAwait<T, E>(cell),
    resolve: (value: T) => { resolved.settle({ ok: true, value }); },
    reject: (reason: E) => { rejected.settle({ ok: false, reason }); },
  };
}
function __promiseWithResolversVoid<E>() {
  const cell = new Channel<{ ok: true } | { ok: false; reason: E }>(1);
  const resolved = cell.clone();
  const rejected = cell.clone();
  return {
    promise: __promiseAwaitVoid<E>(cell),
    resolve: () => { resolved.settle({ ok: true }); },
    reject: (reason: E) => { rejected.settle({ ok: false, reason }); },
  };
}
// A timer's id, which setTimeout and setInterval give and clearTimeout and clearInterval take.
type Timeout = i64;
// The runtime keeps the timers, earliest first, and this one task runs each callback in turn. It
// ends once main has returned and no timer is left.
async function __timerLoop(): Promise<void> {
  while (true) {
    const next = await timerNext();
    if (next === null) return;
    await next();
  }
}
function __timeoutClear(id: Timeout | null): void {
  if (id !== null) timerClear(id);
}
// Promise.resolve(v) and Promise.reject(e).
async function __promiseResolve<T>(value: T): Promise<T> { return value; }
async function __promiseResolveVoid(): Promise<void> {}
async function __promiseReject<T, E>(reason: E): Promise<T> throws E { throw reason; }
async function __promiseRejectVoid<E>(reason: E): Promise<void> throws E { throw reason; }
class ParseArgsError {
  message: string;
  code: string;
  constructor(code: string, message: string) { this.code = code; this.message = message; }
}
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

  // The body read as JSON into a T.
  async json<T>(): Promise<T> throws JsonError {
    return JSON.parse<T>(this.body);
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

  // A response whose body is the value as JSON, typed 'application/json' unless the headers
  // given say otherwise.
  static json<T>(data: Ref<T>, init?: ResponseInit): Response {
    let res = new Response(null, init);
    if (!res.headers.has("content-type")) res.headers.set("content-type", "application/json");
    res.body = JSON.stringify(data);
    return res;
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
// What a macro builds syntax with besides quotes: `ident("x")`, a name the macro's user sees.
const AST_HELPERS = String.raw`
function ident(name: string): AstExpr {
  return { kind: "ident", name, start: 0, end: 0 };
}
`;

// A JSON value of no particular shape, as untyped `JSON.parse` gives one. The alias the parse
// reads takes a name no program can write, so a program's own `Json` can't change it; `Json`
// names it unless the program declares a `Json` of its own.
const JSON_VALUE = String.raw`
type JsonValue = null | boolean | number | string | JsonValue[] | Map<string, JsonValue>;
`;
const JSON_NAME = String.raw`
type Json = JsonValue;
`;
// The name untyped `JSON.parse` reads into.
export const JSON_VALUE_NAME = "json value";

// The std modules a program reaches by a Node specifier, as `node:os` or `os`, or by naming one
// as a global, each Fish source loaded like a file of the program.
export const STD_MODULES: Record<string, string> = {
  os: String.raw`
declare function fsh_rt_os_hostname(): Ptr<u8>;
declare function fsh_rt_os_tmpdir(): Ptr<u8>;
declare function fsh_rt_os_homedir(): Ptr<u8>;
declare function fsh_rt_os_platform(): Ptr<u8>;
declare function fsh_rt_os_parallelism(): i64;

export function hostname(): string {
  return unsafe { fromCString(fsh_rt_os_hostname()) };
}

export function tmpdir(): string {
  return unsafe { fromCString(fsh_rt_os_tmpdir()) };
}

export function homedir(): string {
  return unsafe { fromCString(fsh_rt_os_homedir()) };
}

export function platform(): string {
  return unsafe { fromCString(fsh_rt_os_platform()) };
}

export function availableParallelism(): i64 {
  return unsafe { fsh_rt_os_parallelism() };
}
`,
  // The checker gives these their meaning, as each takes values of any type; a rest parameter
  // keeps them from being used as values.
  util: String.raw`
export function format(...args: string[]): string {
  return args.join(" ");
}

export function inspect(...args: string[]): string {
  return args.join(" ");
}

export function isDeepStrictEqual(...args: string[]): boolean {
  return args.length === 0;
}

declare function fsh_rt_argc(): i64;
declare function fsh_rt_arg(i: i64): Ptr<u8>;

// An option of the call's literal, as the checker gives it: its long name, its short one or "",
// whether it takes a string, and whether it may be given more than once.
type ParseArgsSpec = { name: string; short: string; text: boolean; multiple: boolean };

// What the arguments gave each option, by its place among the specs, for the checker's builder
// of the typed values to read.
class ParsedArgs {
  strings: string[][] = [];
  flags: boolean[][] = [];
  positionals: string[] = [];

  text(i: i64): string | null {
    const given: Ref<string[]> = this.strings[i as usize];
    return given.length === 0 ? null : given[given.length - 1];
  }

  texts(i: i64): string[] | null {
    return this.strings[i as usize].length === 0 ? null : this.strings[i as usize].clone();
  }

  flag(i: i64): boolean | null {
    const given: Ref<boolean[]> = this.flags[i as usize];
    return given.length === 0 ? null : given[given.length - 1];
  }

  flagList(i: i64): boolean[] | null {
    return this.flags[i as usize].length === 0 ? null : this.flags[i as usize].clone();
  }

  textOr(i: i64, fallback: string): string {
    return this.text(i) ?? fallback;
  }

  textsOr(i: i64, fallback: string[]): string[] {
    return this.texts(i) ?? fallback;
  }

  flagOr(i: i64, fallback: boolean): boolean {
    return this.flag(i) ?? fallback;
  }

  flagListOr(i: i64, fallback: boolean[]): boolean[] {
    return this.flagList(i) ?? fallback;
  }
}

function size(s: string): i64 {
  return s.length as i64;
}

function specAt(name: string, specs: Ref<ParseArgsSpec[]>): i64 {
  for (let i: usize = 0; i < specs.length; i++) if (specs[i].name === name) return i as i64;
  return -1;
}

function longFor(short: string, specs: Ref<ParseArgsSpec[]>): string {
  for (const s of specs) if (s.short === short) return s.name;
  return short;
}

function takesText(name: string, specs: Ref<ParseArgsSpec[]>): boolean {
  const i = specAt(name, specs);
  return i >= 0 && specs[i as usize].text;
}

// The program's arguments, process.argv after the two paths it starts with, as Node's default
// gives a script.
function programArgs(): string[] {
  let all: string[] = [];
  const n = unsafe { fsh_rt_argc() };
  for (let i: i64 = 2; i < n; i++) all.push(unsafe { fromCString(fsh_rt_arg(i)) });
  return all;
}

// A JSON string of text with no control characters, as Node's message quotes an option.
function quoted(s: string): string {
  return "\"" + s.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"") + "\"";
}

// Node's message, which leaves its last quote open.
function unknown(raw: string, allowPositionals: boolean): ParseArgsError {
  const hint = allowPositionals ? ". To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- " + quoted(raw) : "";
  return new ParseArgsError("ERR_PARSE_ARGS_UNKNOWN_OPTION", "Unknown option '" + raw + "'" + hint);
}

// One option met in the arguments, checked as Node's strict mode checks it, then stored.
function option(p: Mut<ParsedArgs>, specs: Ref<ParseArgsSpec[]>, given: string, raw: string, value: string | null, inline: boolean, allowPositionals: boolean, allowNegative: boolean): void throws ParseArgsError {
  let name = given;
  let negated = false;
  if (allowNegative && name.startsWith("no-")) {
    const i = specAt(name.slice(3), specs);
    if (i >= 0 && !specs[i as usize].text) {
      name = name.slice(3);
      negated = true;
    }
  }
  const i = specAt(name, specs);
  if (i < 0) throw unknown(raw, allowPositionals);
  const spec: Ref<ParseArgsSpec> = specs[i as usize];
  const both = (spec.short === "" ? "" : "-" + spec.short + ", ") + "--" + name;
  if (spec.text && value === null) throw new ParseArgsError("ERR_PARSE_ARGS_INVALID_OPTION_VALUE", "Option '" + both + " <value>' argument missing");
  if (!spec.text && value !== null) throw new ParseArgsError("ERR_PARSE_ARGS_INVALID_OPTION_VALUE", "Option '" + both + "' does not take an argument");
  if (value !== null && !inline && size(value) > 1 && value.startsWith("-")) {
    const example = raw.startsWith("--") ? "'" + raw + "=-XYZ'" : "'--" + name + "=-XYZ' or '" + raw + "-XYZ'";
    throw new ParseArgsError("ERR_PARSE_ARGS_INVALID_OPTION_VALUE", "Option '" + raw + "' argument is ambiguous.\nDid you forget to specify the option argument for '" + raw + "'?\nTo specify an option argument starting with a dash use " + example + ".");
  }
  // A value given again replaces the last unless the option takes several.
  if (value !== null && spec.multiple) p.strings[i as usize].push(value);
  else if (value !== null) p.strings[i as usize] = [value];
  else if (spec.multiple) p.flags[i as usize].push(!negated);
  else p.flags[i as usize] = [!negated];
}

function positional(p: Mut<ParsedArgs>, arg: string, allowPositionals: boolean): void throws ParseArgsError {
  if (!allowPositionals) throw new ParseArgsError("ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL", "Unexpected argument '" + arg + "'. This command does not take positional arguments");
  p.positionals.push(arg);
}

// A port of Node's parseArgs in strict mode. The checker writes each call's arguments from its
// options literal: the specs, and a builder giving the values typed from them.
export function parseArgs<V>(given: string[] | null, specs: ParseArgsSpec[], allowPositionals: boolean, allowNegative: boolean, build: (p: Ref<ParsedArgs>) => V): { values: V; positionals: string[] } throws ParseArgsError {
  let p = new ParsedArgs();
  for (const _ of specs) {
    p.strings.push([]);
    p.flags.push([]);
  }
  let rest = given ?? programArgs();
  let at: usize = 0;
  while (at < rest.length) {
    const arg = rest[at];
    at++;
    const next: string | null = at < rest.length ? rest[at] : null;
    const n = size(arg);
    if (arg === "--") {
      for (; at < rest.length; at++) positional(p, rest[at], allowPositionals);
      break;
    }
    const short = n >= 2 && arg.charAt(0) === "-" && arg.charAt(1) !== "-";
    if (short && n === 2) {
      const name = longFor(arg.charAt(1), specs);
      let value: string | null = null;
      if (takesText(name, specs) && next !== null) {
        value = next;
        at++;
      }
      option(p, specs, name, arg, value, false, allowPositionals, allowNegative);
      continue;
    }
    if (short && !takesText(longFor(arg.charAt(1), specs), specs)) {
      // -abc is -a -b -c, and a string option in it takes the rest, as -abfFILE is -a -b -fFILE.
      let expanded: string[] = [];
      for (let k: i64 = 1; k < n; k++) {
        const one = arg.charAt(k);
        if (!takesText(longFor(one, specs), specs) || k === n - 1) expanded.push("-" + one);
        else {
          expanded.push("-" + arg.slice(k));
          break;
        }
      }
      for (; at < rest.length; at++) expanded.push(rest[at]);
      rest = expanded;
      at = 0;
      continue;
    }
    if (short) {
      const one = arg.charAt(1);
      option(p, specs, longFor(one, specs), "-" + one, arg.slice(2), true, allowPositionals, allowNegative);
      continue;
    }
    if (n > 2 && arg.startsWith("--")) {
      // As Node's: an "=" past the third character marks a value, which starts after the first.
      if (arg.indexOf("=", 3) < 0) {
        const name = arg.slice(2);
        let value: string | null = null;
        if (takesText(name, specs) && next !== null) {
          value = next;
          at++;
        }
        option(p, specs, name, arg, value, false, allowPositionals, allowNegative);
      } else {
        const eq = arg.indexOf("=");
        const name = arg.slice(2, eq);
        option(p, specs, name, "--" + name, arg.slice(eq + 1), true, allowPositionals, allowNegative);
      }
      continue;
    }
    positional(p, arg, allowPositionals);
  }
  const values = build(p);
  return { values, positionals: p.positionals };
}
`,
  // A port of Node's path.posix for the functions Fish has, so each gives what Node gives.
  path: String.raw`
declare function fsh_rt_cwd(): Ptr<u8>;

// A string's length and the UTF-16 unit at an index, as Node's code reads them, in i64.
function size(s: string): i64 {
  return s.length as i64;
}

// Past the end there is no unit, as a working directory the system couldn't give is empty.
function at(s: string, i: i64): i64 {
  return i >= 0 && i < size(s) ? s.charCodeAt(i as usize) as i64 : -1;
}

function lastSlashOf(s: string): i64 {
  for (let i = size(s) - 1; i >= 0; i--) if (at(s, i) === 47) return i;
  return -1;
}

export const sep = "/";
export const delimiter = ":";

// Node's normalizeString: a path's segments with "." dropped and ".." taken back, above the root
// too when it is relative.
function normalizeString(path: string, allowAboveRoot: boolean): string {
  let res = "";
  let lastSegmentLength: i64 = 0;
  let lastSlash: i64 = -1;
  let dots: i64 = 0;
  let code: i64 = 0;
  for (let i: i64 = 0; i <= size(path); ++i) {
    if (i < size(path)) code = at(path, i);
    else if (code === 47) break;
    else code = 47;
    if (code === 47) {
      if (lastSlash === i - 1 || dots === 1) {
      } else if (dots === 2) {
        if (size(res) < 2 || lastSegmentLength !== 2 || at(res, size(res) - 1) !== 46 || at(res, size(res) - 2) !== 46) {
          if (size(res) > 2) {
            const lastSlashIndex = size(res) - lastSegmentLength - 1;
            if (lastSlashIndex === -1) {
              res = "";
              lastSegmentLength = 0;
            } else {
              res = res.slice(0, lastSlashIndex);
              lastSegmentLength = size(res) - 1 - lastSlashOf(res);
            }
            lastSlash = i;
            dots = 0;
            continue;
          } else if (size(res) !== 0) {
            res = "";
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          res = size(res) > 0 ? res + "/.." : "..";
          lastSegmentLength = 2;
        }
      } else {
        if (size(res) > 0) res = res + "/" + path.slice(lastSlash + 1, i);
        else res = path.slice(lastSlash + 1, i);
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === 46 && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}

function cwd(): string {
  return unsafe { fromCString(fsh_rt_cwd()) };
}

export function resolve(...args: string[]): string {
  if (args.length === 0 || (args.length === 1 && (args[0] === "" || args[0] === "."))) {
    const here = cwd();
    if (at(here, 0) === 47) return here;
  }
  let resolvedPath = "";
  let resolvedAbsolute = false;
  for (let i: i64 = (args.length as i64) - 1; i >= 0 && !resolvedAbsolute; i--) {
    const path = args[i as usize];
    if (size(path) === 0) continue;
    resolvedPath = path + "/" + resolvedPath;
    resolvedAbsolute = at(path, 0) === 47;
  }
  if (!resolvedAbsolute) {
    const here = cwd();
    resolvedPath = here + "/" + resolvedPath;
    resolvedAbsolute = at(here, 0) === 47;
  }
  resolvedPath = normalizeString(resolvedPath, !resolvedAbsolute);
  if (resolvedAbsolute) return "/" + resolvedPath;
  return resolvedPath.length > 0 ? resolvedPath : ".";
}

export function normalize(path: string): string {
  if (size(path) === 0) return ".";
  const isAbsolute = at(path, 0) === 47;
  const trailingSeparator = at(path, size(path) - 1) === 47;
  let out = normalizeString(path, !isAbsolute);
  if (size(out) === 0) {
    if (isAbsolute) return "/";
    return trailingSeparator ? "./" : ".";
  }
  if (trailingSeparator) out = out + "/";
  return isAbsolute ? "/" + out : out;
}

export function join(...args: string[]): string {
  let parts: string[] = [];
  for (const arg of args) if (size(arg) > 0) parts.push(arg);
  if (parts.length === 0) return ".";
  return normalize(parts.join("/"));
}

export function relative(from: string, to: string): string {
  if (from === to) return "";
  const a = resolve(from);
  const b = resolve(to);
  if (a === b) return "";
  const fromStart: i64 = 1;
  const fromEnd = size(a);
  const fromLen = fromEnd - fromStart;
  const toStart: i64 = 1;
  const toLen = size(b) - toStart;
  const length = fromLen < toLen ? fromLen : toLen;
  let lastCommonSep: i64 = -1;
  let i: i64 = 0;
  for (; i < length; i++) {
    const fromCode = at(a, fromStart + i);
    if (fromCode !== at(b, toStart + i)) break;
    else if (fromCode === 47) lastCommonSep = i;
  }
  if (i === length) {
    if (toLen > length) {
      if (at(b, toStart + i) === 47) return b.slice(toStart + i + 1);
      if (i === 0) return b.slice(toStart + i);
    } else if (fromLen > length) {
      if (at(a, fromStart + i) === 47) lastCommonSep = i;
      else if (i === 0) lastCommonSep = 0;
    }
  }
  let out = "";
  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
    if (i === fromEnd || at(a, i) === 47) out = out + (size(out) === 0 ? ".." : "/..");
  }
  return out + b.slice(toStart + lastCommonSep);
}

export function dirname(path: string): string {
  if (size(path) === 0) return ".";
  const hasRoot = at(path, 0) === 47;
  let end: i64 = -1;
  let matchedSlash = true;
  for (let i: i64 = size(path) - 1; i >= 1; --i) {
    if (at(path, i) === 47) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }
  if (end === -1) return hasRoot ? "/" : ".";
  if (hasRoot && end === 1) return "//";
  return path.slice(0, end);
}

export function basename(path: string, suffix?: string): string {
  let start: i64 = 0;
  let end: i64 = -1;
  let matchedSlash = true;
  if (suffix !== null && size(suffix) > 0 && size(suffix) <= size(path)) {
    if (suffix === path) return "";
    let extIdx: i64 = size(suffix) - 1;
    let firstNonSlashEnd: i64 = -1;
    for (let i: i64 = size(path) - 1; i >= 0; --i) {
      const code = at(path, i);
      if (code === 47) {
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else {
        if (firstNonSlashEnd === -1) {
          matchedSlash = false;
          firstNonSlashEnd = i + 1;
        }
        if (extIdx >= 0) {
          if (code === at(suffix, extIdx)) {
            if (--extIdx === -1) end = i;
          } else {
            extIdx = -1;
            end = firstNonSlashEnd;
          }
        }
      }
    }
    if (start === end) end = firstNonSlashEnd;
    else if (end === -1) end = size(path);
    return path.slice(start, end);
  }
  for (let i: i64 = size(path) - 1; i >= 0; --i) {
    if (at(path, i) === 47) {
      if (!matchedSlash) {
        start = i + 1;
        break;
      }
    } else if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
  }
  if (end === -1) return "";
  return path.slice(start, end);
}

export function extname(path: string): string {
  let startDot: i64 = -1;
  let startPart: i64 = 0;
  let end: i64 = -1;
  let matchedSlash = true;
  let preDotState: i64 = 0;
  for (let i: i64 = size(path) - 1; i >= 0; --i) {
    const code = at(path, i);
    if (code === 47) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
    if (code === 46) {
      if (startDot === -1) startDot = i;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }
  if (startDot === -1 || end === -1 || preDotState === 0 || (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)) return "";
  return path.slice(startDot, end);
}
`,
  // Files read and written on the runtime's blocking pool. A call naming an encoding, as
  // readFile(path, "utf8"), is linked to readFileText, which gives a string.
  "fs/promises": String.raw`
export async function readFile(path: string): Promise<u8[]> throws IoError {
  return await fileRead(path);
}

export async function readFileText(path: string): Promise<string> throws IoError {
  const bytes = await fileRead(path);
  return new TextDecoder().decode(bytes);
}

export async function writeFile(path: string, data: string | u8[]): Promise<void> throws IoError {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  await fileWrite(path, bytes);
}
`,
  fs: String.raw`
export function readFileSync(path: string): u8[] throws IoError {
  return fileReadSync(path);
}

export function readFileSyncText(path: string): string throws IoError {
  const bytes = fileReadSync(path);
  return new TextDecoder().decode(bytes);
}

export function writeFileSync(path: string, data: string | u8[]): void throws IoError {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  fileWriteSync(path, bytes);
}

export function existsSync(path: string): boolean {
  return pathExists(path);
}

export class Stats {
  size: i64;
  mode: i64;
  mtimeMs: f64;
  kind: i64;
  constructor(size: i64, mode: i64, mtimeMs: f64, kind: i64) {
    this.size = size;
    this.mode = mode;
    this.mtimeMs = mtimeMs;
    this.kind = kind;
  }
  isFile(): boolean { return this.kind === 1; }
  isDirectory(): boolean { return this.kind === 2; }
  isSymbolicLink(): boolean { return this.kind === 3; }
}

function stats(path: string, follow: boolean): Stats throws IoError {
  const [size, mode, mtimeMs, kind] = pathStat(path, follow);
  return new Stats(size, mode, mtimeMs, kind);
}

export function statSync(path: string): Stats throws IoError {
  return stats(path, true);
}

export function lstatSync(path: string): Stats throws IoError {
  return stats(path, false);
}

export function readdirSync(path: string): string[] throws IoError {
  return dirRead(path);
}

export function realpathSync(path: string): string throws IoError {
  return pathReal(path);
}

export function mkdtempSync(prefix: string): string throws IoError {
  return dirTemp(prefix);
}

export type RmOptions = { recursive?: boolean; force?: boolean };

export function rmSync(path: string, options: RmOptions = {}): void throws IoError {
  pathRemove(path, options.recursive ?? false, options.force ?? false);
}
`,
  process: String.raw`
declare function fsh_rt_argc(): i64;
declare function fsh_rt_arg(i: i64): Ptr<u8>;
declare function fsh_rt_getenv(name: Ptr<u8>): Ptr<u8>;
declare function fsh_rt_exit(code: i64): void;

export function argv(): string[] {
  let all: string[] = [];
  const n = unsafe { fsh_rt_argc() };
  for (let i: i64 = 0; i < n; i++) all.push(unsafe { fromCString(fsh_rt_arg(i)) });
  return all;
}

export function env(name: string): string | null {
  const value = unsafe { fsh_rt_getenv(cString(name)) };
  if (unsafe { value.isNull() }) return null;
  return unsafe { fromCString(value) };
}

export function exit(code: i64 = 0): never {
  unsafe { fsh_rt_exit(code) };
  // The C call never returns.
  while (true) {}
}
`,
};

// Members of a std module read as values, each through a function of its: `argv` as
// `process.argv`, called with nothing, and `env` as a table, `process.env.HOME` and
// `process.env[name]` calling it with the key.
export const STD_VALUES: Record<string, Record<string, "value" | "table">> = {
  process: { argv: "value", env: "table" },
};

// The compiler's own tests run JS through this module, which no program may import: Fish has no
// way to run JS source, only packages.
export const ENGINE_HOOK = String.raw`
export function evaluate(module: string): JsValue {
  return jsEvaluate(module);
}
`;

// The std module a specifier names, if any: `node:os` and `os` both name `os`.
export function stdModule(specifier: string): string | undefined {
  const bare = specifier.startsWith("node:") ? specifier.slice("node:".length) : specifier;
  // "path/posix" is "path", which is POSIX's here.
  const name = bare === "path/posix" ? "path" : bare;
  return Object.hasOwn(STD_MODULES, name) ? name : undefined;
}

export const STD_SOURCE = PRELUDE + HTTP + JSON_VALUE + JSON_NAME + AST + AST_HELPERS;
export const STD_FILE = "<fish std>";

// The std statements a program is checked with, their spans moved past its own.
export function stdFor(written: Stmt[]): Stmt[] {
  const all = parse(STD_SOURCE);
  shiftSpans(all, STD_BASE);
  // The array iterators' generators and the promise cells take names no program can write, so
  // none hides them.
  hideHelpers(all);
  const at = (s: Stmt) => s.start - STD_BASE;
  const prelude = all.filter((s) => at(s) < PRELUDE.length);
  const http = all.filter((s) => at(s) >= PRELUDE.length && at(s) < PRELUDE.length + HTTP.length);
  const jsonAt = PRELUDE.length + HTTP.length;
  const json = all.filter((s) => at(s) >= jsonAt && at(s) < jsonAt + JSON_VALUE.length);
  const jsonName = all.filter((s) => at(s) >= jsonAt + JSON_VALUE.length && at(s) < jsonAt + JSON_VALUE.length + JSON_NAME.length);
  renameValue([...json, ...jsonName]);
  const ast = all.filter((s) => at(s) >= jsonAt + JSON_VALUE.length + JSON_NAME.length);
  const astNames = ast.flatMap((s) => ("name" in s && typeof s.name === "string" ? [s.name] : []));
  const parts = [[http, HTTP_NAMES], [json, ["Json", "JSON"]], [jsonName, ["Json"]], [ast, [...astNames, "quote", "quoteType"]]] as const;
  return [...prelude, ...parts.flatMap(([part, names]) => (uses(written, part, [...names]) ? part : []))];
}

// The prelude's helpers, declared and called as `__arrayFilled`, become `array filled`, which
// no program can write.
function hideHelpers(nodes: unknown) {
  if (Array.isArray(nodes)) return nodes.forEach(hideHelpers);
  if (typeof nodes !== "object" || nodes === null) return;
  const node = nodes as Record<string, unknown>;
  if ((node.kind === "function" || node.kind === "ident") && typeof node.name === "string" && /^__(array|promise|timer|timeout)/.test(node.name)) {
    node.name = node.name.slice(2).replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`);
  }
  Object.values(node).forEach(hideHelpers);
}

// Gives the std's JSON value alias its unwritable name, shown as `Json` in messages.
function renameValue(nodes: unknown) {
  if (Array.isArray(nodes)) return nodes.forEach(renameValue);
  if (typeof nodes !== "object" || nodes === null) return;
  const node = nodes as Record<string, unknown>;
  if ((node.kind === "ref" || node.kind === "typeAlias") && node.name === "JsonValue") {
    node.name = JSON_VALUE_NAME;
    if (node.kind === "typeAlias") node.shown = "Json";
  }
  Object.values(node).forEach(renameValue);
}

// A program that refers to a library by one of its names gets it, unless it declares one of the
// library's top-level names itself.
function uses(written: Stmt[], library: Stmt[], wanted: string[]): boolean {
  const declared = new Set(written.map((s) => ("name" in s ? s.name : undefined)));
  if (library.some((s) => "name" in s && declared.has(s.name))) return false;
  const names = (v: unknown): boolean => {
    if (Array.isArray(v)) return v.some(names);
    if (typeof v !== "object" || v === null) return false;
    const node = v as Record<string, unknown>;
    const named = (node.kind === "ident" || node.kind === "ref") && typeof node.name === "string" && wanted.includes(node.name);
    return named || Object.values(node).some(names);
  };
  return names(written);
}
