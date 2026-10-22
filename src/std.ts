import { parse, type Stmt } from "./parser.ts";

// Fish's std library, as Fish source checked with each program. The prelude goes into every
// program; the HTTP library only into one that names it.

const PRELUDE = `
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
  const listener = await TcpListener.bind(hostname, port);
  const bound = listener.port;
  const listen = options.onListen;
  if (listen !== null) listen({ hostname: hostname, port: bound });
  let stop = new AbortController().signal;
  const given = options.signal;
  if (given !== null) stop = given;
  const live = shared({ count: new Atomic(0) });
  const boxed: ServeHandler = handler;
  const host = hostname + ":" + String(bound);
  while (true) {
    try {
      const conn = await listener.accept(stop);
      live.count.add(1);
      spawn(Http1.tracked(conn, boxed.clone(), host, stop.clone(), live.clone()));
    } catch (e) {
      if (e instanceof AbortError) break;
      throw e;
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

// One connection's requests, one after another while both sides keep it open.
async function serveConnection(conn: TcpStream, handler: ServeHandler, host: string, stop: AbortSignal): Promise<void> {
  let buffer: u8[] = [];
  try {
    while (true) {
      let end = Http1.headEnd(buffer);
      while (end < 0) {
        // A head may take 16 KiB, and a body 1 MiB.
        if ((buffer.length as i64) > 16384) { await Http1.refuse(conn, 431); return; }
        const got = await Http1.idleRead(conn, stop, buffer.length === 0);
        if (got.length === 0) return;
        for (const b of got) buffer.push(b);
        end = Http1.headEnd(buffer);
      }
      if (end > 16384) { await Http1.refuse(conn, 431); return; }
      const head = Http1.parseHead(new TextDecoder().decode(Http1.take(buffer, 0, end)));
      if (head === null) { await Http1.refuse(conn, 400); return; }
      buffer = Http1.take(buffer, end + 4, buffer.length as i64);
      if (head.headers.has("transfer-encoding")) { await Http1.refuse(conn, 501); return; }
      const length = Http1.contentLength(head.headers);
      if (length < 0) { await Http1.refuse(conn, 400); return; }
      if (length > 1048576) { await Http1.refuse(conn, 413); return; }
      if (length > 0 && head.headers.get("expect") === "100-continue") {
        await conn.write(new TextEncoder().encode("HTTP/1.1 100 Continue\\r\\n\\r\\n"));
      }
      while ((buffer.length as i64) < length) {
        const got = await conn.read(16384);
        if (got.length === 0) return;
        for (const b of got) buffer.push(b);
      }
      const body = new TextDecoder().decode(Http1.take(buffer, 0, length));
      buffer = Http1.take(buffer, length, buffer.length as i64);
      const keep = Http1.keepAlive(head);
      const method = head.method;
      let hostHeader = host;
      const named = head.headers.get("host");
      if (named !== null) hostHeader = named;
      // While the handler runs, a watcher aborts the request's signal if the client goes away.
      const client = new AbortController();
      const signal = client.signal;
      const done = new AbortController();
      const watching = spawn(Http1.watch(conn.clone(), client, done.signal));
      const req = new Request("http://" + hostHeader + head.target, { method: method, headers: head.headers, body: body, signal: signal });
      const res = await handler(req);
      done.abort();
      const early = await watching;
      for (const b of early) buffer.push(b);
      const close = !keep || stop.aborted || res.headers.get("connection") === "close";
      await conn.write(new TextEncoder().encode(Http1.responseText(res, method === "HEAD", close)));
      if (close) return;
    }
  } catch (e) {
    return;
  }
}

// The wire format of HTTP/1.x.
class Http1 {
  // A connection's requests, counted while it is open so the server can wait for it at shutdown.
  static async tracked(conn: TcpStream, handler: ServeHandler, host: string, stop: AbortSignal, live: shared<{ count: Atomic<i64> }>): Promise<void> {
    await serveConnection(conn, handler, host, stop);
    live.count.sub(1);
  }

  // Waits for the client's next bytes. Between requests the connection is idle: it closes after
  // 5 seconds, or once the server stops, giving nothing.
  // ponytail: wakes every 250 ms to look at the server's signal; AbortSignal.any would combine them.
  static async idleRead(conn: Ref<TcpStream>, stop: Ref<AbortSignal>, idle: boolean): Promise<u8[]> throws IoError {
    if (!idle) {
      const got = await conn.read(16384);
      return got;
    }
    for (let waited = 0; waited < 5000 && !stop.aborted; waited += 250) {
      try {
        const got = await conn.read(16384, AbortSignal.timeout(250));
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
  static async refuse(conn: Ref<TcpStream>, status: i64): Promise<void> throws IoError {
    const res = new Response(Http1.reasonPhrase(status) + "\\n", { status: status });
    await conn.write(new TextEncoder().encode(Http1.responseText(res, false, true)));
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

  // Where a request's head ends: the index of its blank line's CR LF CR LF, or -1.
  static headEnd(buffer: Ref<u8[]>): i64 {
    for (let i: usize = 0; i + 3 < buffer.length; i++) {
      if (buffer[i] === 13 && buffer[i + 1] === 10 && buffer[i + 2] === 13 && buffer[i + 3] === 10) return i as i64;
    }
    return -1;
  }

  // The bytes from start to end, as a new array.
  static take(buffer: Ref<u8[]>, start: i64, end: i64): u8[] {
    let out: u8[] = [];
    for (let i = start as usize; i < (end as usize); i++) out.push(buffer[i]);
    return out;
  }

  // The request line and headers, or null when they aren't HTTP/1.x.
  static parseHead(text: string): HttpHead | null {
    const lines = text.split("\\r\\n");
    const parts = lines[0].split(" ");
    if (parts.length !== 3 || parts[0].length === 0 || !parts[1].startsWith("/")) return null;
    const version = parts[2];
    if (version !== "HTTP/1.1" && version !== "HTTP/1.0") return null;
    let headers = new Headers();
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const colon = line.indexOf(":");
      // A name is one token: nothing before it, and no space before its colon.
      if (colon <= 0 || line.startsWith(" ") || line.startsWith("\\t")) return null;
      const name = line.slice(0, colon);
      if (name.includes(" ") || name.includes("\\t")) return null;
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
    const said = asked === null ? "" : asked.toLowerCase();
    if (head.version === "HTTP/1.0") return said === "keep-alive";
    return said !== "close";
  }

  // A response's status line, headers and body, as sent.
  static responseText(res: Ref<Response>, head: boolean, close: boolean): string {
    let reason = res.statusText;
    if (reason.length === 0) reason = Http1.reasonPhrase(res.status);
    let text = "HTTP/1.1 " + String(res.status) + " " + reason + "\\r\\n";
    res.headers.forEach((value: string, name: string) => {
      if (name !== "content-length" && name !== "connection" && name !== "date") text = text + name + ": " + value + "\\r\\n";
    });
    const size = new TextEncoder().encode(res.body).length;
    text = text + "content-length: " + String(size as i64) + "\\r\\n";
    text = text + "date: " + httpDate() + "\\r\\n";
    if (close) text = text + "connection: close\\r\\n";
    text = text + "\\r\\n";
    if (!head) text = text + res.body;
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

const HTTP_NAMES = ["serve", "Request", "Response", "Headers"];

// The std source sits past every program's in offsets, so a position says which it is in.
export const STD_BASE = 1 << 30;
export const STD_SOURCE = PRELUDE + HTTP;
export const STD_FILE = "<fish std>";

// The std statements a program is checked with, their spans moved past its own.
export function stdFor(written: Stmt[]): Stmt[] {
  const all = parse(STD_SOURCE);
  shift(all);
  return all.filter((s) => s.start - STD_BASE < PRELUDE.length || usesHttp(written));
}

// A program that names the HTTP library gets it, unless it declares those names itself.
function usesHttp(written: Stmt[]): boolean {
  const declared = new Set(written.map((s) => ("name" in s ? s.name : undefined)));
  if (HTTP_NAMES.some((n) => declared.has(n))) return false;
  const names = (v: unknown): boolean => {
    if (Array.isArray(v)) return v.some(names);
    if (typeof v !== "object" || v === null) return false;
    const node = v as Record<string, unknown>;
    return (typeof node.name === "string" && HTTP_NAMES.includes(node.name)) || Object.values(node).some(names);
  };
  return names(written);
}

function shift(v: unknown, seen = new Set<unknown>()) {
  if (typeof v !== "object" || v === null || seen.has(v)) return;
  seen.add(v);
  if (Array.isArray(v)) return v.forEach((x) => shift(x, seen));
  const node = v as Record<string, unknown>;
  if (typeof node.start === "number") node.start += STD_BASE;
  if (typeof node.end === "number") node.end += STD_BASE;
  Object.values(node).forEach((x) => shift(x, seen));
}
