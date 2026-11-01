import { deserialize, serialize } from "bun:jsc";
import { createHash } from "node:crypto";
import type { Compilation, Session } from "./compilation.ts";
import type { Source } from "./diag.ts";
import { readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AST } from "./ast.ts";
import { cacheDir, partial } from "./mathlib.ts";
import { nextId, renumber } from "./nodes.ts";
import { parse, shiftSpans, type Pattern, type Stmt } from "./parser.ts";

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
function* __iterMap<T, U>(g: Generator<T>, f: (value: T, index: i64) => U): Generator<U> {
  let i = 0;
  for (const x of g) {
    yield f(x, i);
    i++;
  }
}
function* __iterFilter<T>(g: Generator<T>, f: (value: Ref<T>, index: i64) => boolean): Generator<T> {
  let i = 0;
  for (const x of g) {
    if (f(x, i)) yield x;
    i++;
  }
}
function* __iterTake<T>(g: Generator<T>, n: i64): Generator<T> {
  if (n === 0) return;
  let i = 0;
  for (const x of g) {
    yield x;
    i++;
    if (i === n) return;
  }
}
function* __iterDrop<T>(g: Generator<T>, n: i64): Generator<T> {
  let i = 0;
  for (const x of g) {
    if (i < n) i++;
    else yield x;
  }
}
function* __iterFlatMap<T, U>(g: Generator<T>, f: (value: T, index: i64) => U[]): Generator<U> {
  let i = 0;
  for (const x of g) {
    // ponytail: each element is cloned, since a loop over an array lends them; moving them out
    // needs an owning loop over arrays.
    const ys = f(x, i);
    for (const y of ys) yield y.clone();
    i++;
  }
}
function* __iterFlatMapGenerator<T, U, G extends Generator<U>>(g: Generator<T>, f: (value: T, index: i64) => G): Generator<U> {
  let i = 0;
  for (const x of g) {
    const ys = f(x, i);
    yield* ys;
    i++;
  }
}
function __iterReduce<T, A>(g: Generator<T>, f: (accumulator: A, value: T, index: i64) => A, init: A): A {
  let acc = init;
  let i = 0;
  for (const x of g) {
    acc = f(acc, x, i);
    i++;
  }
  return acc;
}
// The fold in a one-element tuple, so a 'T' that may itself be null isn't taken for empty.
function __iterReduceFirst<T>(g: Generator<T>, f: (accumulator: T, value: T, index: i64) => T): [T] | null {
  let it = g;
  const first = it.next();
  if (first.done === true) return null;
  let acc = first.value;
  let i = 1;
  for (const x of it) {
    acc = f(acc, x, i);
    i++;
  }
  return [acc];
}
function __iterForEach<T>(g: Generator<T>, f: (value: T, index: i64) => void) {
  let i = 0;
  for (const x of g) {
    f(x, i);
    i++;
  }
}
function __iterSome<T>(g: Generator<T>, f: (value: Ref<T>, index: i64) => boolean): boolean {
  let i = 0;
  for (const x of g) {
    if (f(x, i)) return true;
    i++;
  }
  return false;
}
function __iterEvery<T>(g: Generator<T>, f: (value: Ref<T>, index: i64) => boolean): boolean {
  let i = 0;
  for (const x of g) {
    if (!f(x, i)) return false;
    i++;
  }
  return true;
}
function __iterFind<T>(g: Generator<T>, f: (value: Ref<T>, index: i64) => boolean): T | null {
  let i = 0;
  for (const x of g) {
    if (f(x, i)) return x;
    i++;
  }
  return null;
}
// The count 'take' or 'drop' was given, or nothing when it is negative, which panics at the call.
function __iterCount(n: i64): i64 | null {
  if (n < 0) return null;
  return n;
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
// What awaiting 'handle.join()' throws when the task panicked: its panic's reason.
class TaskPanic { message: string; constructor(message: string) { this.message = message; } }
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
// What JavaScript throws for a value of the wrong kind, as 'new URL' does for one that isn't a URL.
class TypeError {
  name: string = "TypeError";
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
    if (next !== null) {
      await next();
    } else {
      // An async callback still running may set another timer, so the program waits for it.
      // ponytail: polled every millisecond; wake the loop from the callback's end if that shows up
      if (__timerRunning.load() === 0) return;
      await sleep(1);
    }
  }
}
// An async callback runs as a task of its own, as JavaScript's runs on while later timers fire,
// so one awaiting another timer doesn't stop the timer task that would fire it. Its first part
// runs at once, so timers due together still run in the order they were set.
const __timerRunning = new Atomic(0);
function __timerDetached(callback: () => Promise<void>): () => Promise<void> {
  return async () => {
    __timerRunning.add(1);
    __timerSpawn(__timerRun(callback()));
  };
}
async function __timerRun(running: Promise<void>): Promise<void> {
  await running;
  __timerRunning.sub(1);
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

// A cookie's attributes, with Bun's names. maxAge is in seconds and expires a Date or milliseconds
// since the epoch, as Date.now() gives.
type CookieInit = { path?: string; domain?: string; maxAge?: i64; expires?: i64 | Date; secure?: boolean; httpOnly?: boolean; sameSite?: "strict" | "lax" | "none"; partitioned?: boolean };

// Cookies by name, as Bun's CookieMap: read from a Cookie header as RFC 6265 reads one, the
// first of a repeated name kept, and changed by set and delete, each change a Set-Cookie line
// a response sends.
class CookieMap {
  #cookies: Map<string, string> = new Map();
  // The latest Set-Cookie line for each name changed, in the order they were first changed.
  #changed: string[] = [];
  #lines: string[] = [];

  constructor(header?: string) {
    if (header === null) return;
    for (const part of header.split(";")) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      const name = part.slice(0, eq).trim();
      if (name.length === 0 || this.#cookies.has(name)) continue;
      let value = part.slice(eq + 1).trim();
      if (value.length >= 2 && value.startsWith("\\"") && value.endsWith("\\"")) value = value.slice(1, -1);
      const decoded = value.includes("%") ? __urlDecodeStrict(value) : value;
      this.#cookies.set(name, decoded ?? value);
    }
  }

  get(name: string): string | null {
    return this.#cookies.get(name);
  }

  has(name: string): boolean {
    return this.#cookies.has(name);
  }

  get size(): i64 {
    return this.#cookies.size as i64;
  }

  forEach(callback: (value: string, name: string) => void) {
    for (const [name, value] of this.#cookies) callback(value, name);
  }

  // Sets a cookie, with Bun's defaults of path '/' and SameSite=Lax. A name must be an HTTP
  // token and a path or domain printable ASCII without ';'; the value is percent-encoded as
  // encodeURIComponent does, so nothing in it can end the cookie or the header.
  set(this: Mut<this>, name: string, value: string, options?: CookieInit) {
    const line = __cookieLine(name, value, options);
    // Deleted first, so a cookie set again comes last, as Bun orders it.
    this.#cookies.delete(name);
    this.#cookies.set(name, value);
    this.#change(name, line);
  }

  // Removes a cookie, telling the client to drop its copy at the path and domain given.
  delete(this: Mut<this>, name: string, options?: { path?: string; domain?: string }) {
    let path: string | null = null;
    let domain: string | null = null;
    if (options !== null) {
      path = options.path;
      domain = options.domain;
    }
    const line = __cookieLine(name, "", { path: path, domain: domain, expires: 0, maxAge: 0 });
    this.#cookies.delete(name);
    this.#change(name, line);
  }

  #change(this: Mut<this>, name: string, line: string) {
    for (let i = 0; i < this.#changed.length; i++) {
      if (this.#changed[i] === name) {
        this.#lines[i] = line;
        return;
      }
    }
    this.#changed.push(name);
    this.#lines.push(line);
  }

  // The Set-Cookie header values the changes make, one per cookie.
  toSetCookieHeaders(): string[] {
    return this.#lines.clone();
  }
}

// A request's cookies, which can be read but not changed: a change goes on the response, through
// res.cookies.
class RequestCookies {
  #cookies: CookieMap;
  constructor(header: string) { this.#cookies = new CookieMap(header); }
  get(name: string): string | null { return this.#cookies.get(name); }
  has(name: string): boolean { return this.#cookies.has(name); }
  get size(): i64 { return this.#cookies.size; }
  forEach(callback: (value: string, name: string) => void) { this.#cookies.forEach(callback); }
}

// A Set-Cookie header's value: the cookie, then its attributes in the order Bun writes them.
function __cookieLine(name: string, value: string, options: CookieInit | null): string {
  assert(Http1.isToken(name), "a cookie's name must be an HTTP token, of letters, digits and !#$%&'*+-.^_|~, so '" + name + "' can't be one");
  let out = new TextEncoder().encode(name + "=");
  for (const c of __urlPoints(value)) {
    const kept = __urlAlpha(c) || __urlDigit(c) || c === 33 || (c >= 39 && c <= 42) || c === 45 || c === 46 || c === 95 || c === 126;
    __urlPut(out, c, kept ? "none" : "form");
  }
  let line = new TextDecoder().decode(out);
  let path = "/";
  let sameSite = "Lax";
  if (options !== null) {
    const domain = options.domain;
    if (domain !== null && domain.length > 0) line = line + "; Domain=" + __cookieAttribute(name, "domain", domain);
    const p = options.path;
    if (p !== null) path = __cookieAttribute(name, "path", p);
    const s = options.sameSite;
    if (s !== null) sameSite = s === "strict" ? "Strict" : s === "none" ? "None" : "Lax";
  }
  if (path.length > 0) line = line + "; Path=" + path;
  if (options !== null) {
    const expires = options.expires;
    if (expires !== null) {
      const ms = expires instanceof Date ? expires.getTime() : expires;
      // An HTTP date has a four-digit year, so 0000-01-01 to 9999-12-31 can be written.
      assert(ms >= -62167219200000 && ms <= 253402300799999, "cookie '" + name + "' can't expire at " + String(ms) + "; give a time within the years 0000 to 9999");
      line = line + "; Expires=" + new Date(ms).toUTCString();
    }
    const maxAge = options.maxAge;
    if (maxAge !== null) line = line + "; Max-Age=" + String(maxAge);
    if (options.secure === true) line = line + "; Secure";
    if (options.httpOnly === true) line = line + "; HttpOnly";
    if (options.partitioned === true) line = line + "; Partitioned";
  }
  return line + "; SameSite=" + sameSite;
}

// A path or domain, which a ';' would end and a control character could break out of the header.
function __cookieAttribute(name: string, attribute: string, value: string): string {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i) as i64;
    assert(c >= 32 && c < 127 && c !== 59, "cookie '" + name + "' can't have a " + attribute + " holding ';', a control character or a character outside ASCII");
  }
  return value;
}

type RequestInit = { method?: string; headers?: Headers; body?: string | u8[]; signal?: AbortSignal };

// A body given as text or bytes, as the bytes sent.
function __httpBody(body: string | u8[]): u8[] {
  return typeof body === "string" ? new TextEncoder().encode(body) : body;
}

class Request {
  method: string;
  url: string;
  path: string;
  headers: Headers;
  body: u8[];
  signal: AbortSignal;
  // The :params a Router's route took from the path, as name then value.
  params: string[] = [];

  constructor(url: string, init?: RequestInit) {
    this.url = url;
    this.path = __urlRequestPath(url);
    let method = "GET";
    let headers = new Headers();
    let body: u8[] = [];
    let signal = new AbortController().signal;
    if (init !== null) {
      const m = init.method;
      if (m !== null) method = m.toUpperCase();
      const h = init.headers;
      if (h !== null) headers = h;
      const b = init.body;
      if (b !== null) body = __httpBody(b);
      const s = init.signal;
      if (s !== null) signal = s;
    }
    this.method = method;
    this.headers = headers;
    this.body = body;
    this.signal = signal;
  }

  // The body as UTF-8 text, each malformed sequence as U+FFFD.
  async text(): Promise<string> {
    return new TextDecoder().decode(this.body);
  }

  // The body's bytes as they were sent.
  async bytes(): Promise<u8[]> {
    return this.body.clone();
  }

  // The body read as JSON into a T.
  async json<T>(): Promise<T> throws JsonError {
    return JSON.parse<T>(new TextDecoder().decode(this.body));
  }

  // The cookies of every Cookie header the request has.
  get cookies(): RequestCookies {
    let all: string[] = [];
    for (let i = 0; i < this.headers.names.length; i++) {
      if (this.headers.names[i] === "cookie") all.push(this.headers.values[i]);
    }
    return new RequestCookies(all.join("; "));
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
// One server-sent event: its data, and the event type, ID and reconnection delay it may name.
type ServerSentEvent = { data: string; event?: string; id?: string; retry?: i64 };

class Response {
  status: i64;
  statusText: string;
  headers: Headers;
  body: u8[];
  // A body sent in pieces as the generator produces them, in place of body. Locked, in an
  // array of at most one, so whoever reads it can take it out through a shared borrow; private,
  // so a response prints as it would without one.
  #stream: Lock<Dyn<AsyncGenerator<string>>[]>;
  // 1 once text() has read a streamed body, which no copy can then have.
  #read: Atomic<i64> = new Atomic(0);
  // The URL fetch got it from, or "" for one the program built.
  url: string = "";
  // The cookies it sets and deletes, each sent as a Set-Cookie header of its own.
  cookies: CookieMap = new CookieMap();

  // A text or streamed body is typed 'text/plain;charset=UTF-8' unless the headers say
  // otherwise; bytes are given no type, as Bun does.
  constructor(body?: string | u8[] | Dyn<AsyncGenerator<string>> | null, init?: ResponseInit) {
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
    let bytes: u8[] = [];
    let stream: Dyn<AsyncGenerator<string>>[] = [];
    if (typeof body === "string") {
      bytes = new TextEncoder().encode(body);
      if (!headers.has("content-type")) headers.set("content-type", "text/plain;charset=UTF-8");
    } else if (Array.isArray(body)) bytes = body;
    else if (body !== null) {
      stream.push(body);
      if (!headers.has("content-type")) headers.set("content-type", "text/plain;charset=UTF-8");
    }
    this.status = status;
    this.statusText = statusText;
    this.headers = headers;
    this.body = bytes;
    this.#stream = new Lock(stream);
  }

  // A response whose body is the value as JSON, typed 'application/json' unless the headers
  // given say otherwise.
  static json<T>(data: Ref<T>, init?: ResponseInit): Response {
    let res = new Response(null, init);
    if (!res.headers.has("content-type")) res.headers.set("content-type", "application/json");
    res.body = new TextEncoder().encode(JSON.stringify(data));
    return res;
  }

  // A response streaming server-sent events as EventSource reads them, each string an event's
  // data, typed 'text/event-stream' and uncached unless the headers given say otherwise.
  static sse(events: AsyncGenerator<string | ServerSentEvent>, init?: ResponseInit): Response {
    let res = new Response(null, init);
    if (!res.headers.has("content-type")) res.headers.set("content-type", "text/event-stream");
    if (!res.headers.has("cache-control")) res.headers.set("cache-control", "no-cache");
    return new Response(__sseFrames(events), { status: res.status, statusText: res.statusText, headers: res.headers });
  }

  get ok(): boolean {
    return this.status >= 200 && this.status < 300;
  }

  // A copy of the response. A streamed body runs its generator once, so it can't be copied.
  clone(): Response {
    const streamed = this.#stream.update((s) => s.length > 0);
    assert(this.#read.load() === 0, "this Response's streamed body was already read, so it can't be cloned; make each copy from the text it gave");
    assert(!streamed, "a Response with a streamed body can't be cloned, since its generator runs once; read it with 'await res.text()' and make each copy from that text");
    let copy = new Response(null, { status: this.status, statusText: this.statusText, headers: this.headers.clone() });
    copy.body = this.body.clone();
    copy.url = this.url;
    copy.cookies = this.cookies.clone();
    return copy;
  }

  // The streamed body, taken out for whoever sends or reads it, or null when there is none.
  __stream(): Dyn<AsyncGenerator<string>> | null {
    return this.#stream.update((s) => s.pop());
  }

  // The body as UTF-8 text, each malformed sequence as U+FFFD. A streamed one is read to its
  // end, once: a second read finds it empty.
  async text(): Promise<string> {
    const stream = this.__stream();
    if (stream === null) return new TextDecoder().decode(this.body);
    this.#read.store(1);
    let pieces = stream;
    let text = "";
    for await (const piece of pieces) text += piece;
    return text;
  }

  // The body's bytes as they were sent; a streamed one's as text() reads it.
  async bytes(): Promise<u8[]> {
    if (!this.#stream.update((s) => s.length > 0)) return this.body.clone();
    const text = await this.text();
    return new TextEncoder().encode(text);
  }

  // The body read as JSON into a T.
  async json<T>(): Promise<T> throws JsonError {
    return JSON.parse<T>(new TextDecoder().decode(this.body));
  }
}

// Each event as the event-stream format writes it: a field per line, a data line per line of
// data, and a blank line to end it.
async function* __sseFrames(events: AsyncGenerator<string | ServerSentEvent>): AsyncGenerator<string> {
  let source = events;
  for await (const e of source) {
    let text = "";
    let data = "";
    if (typeof e === "string") data = e;
    else {
      // A line break would end the field and start another, so single-line fields lose theirs.
      const event = e.event;
      if (event !== null) text = text + "event: " + __sseLine(event) + "\\n";
      const id = e.id;
      if (id !== null) text = text + "id: " + __sseLine(id) + "\\n";
      const retry = e.retry;
      if (retry !== null) text = text + "retry: " + String(retry) + "\\n";
      data = e.data;
    }
    // EventSource ends a line at CR LF, at a lone CR and at a lone LF.
    for (const line of data.replaceAll("\\r\\n", "\\n").replaceAll("\\r", "\\n").split("\\n")) text = text + "data: " + line + "\\n";
    yield text + "\\n";
  }
}

function __sseLine(value: string): string {
  return value.replaceAll("\\r", "").replaceAll("\\n", "");
}

type ServeInfo = { hostname: string; port: i64 };
// Body sizes are in bytes and timeouts in milliseconds; a timeout of 0 is none.
type ServeOptions = { port?: i64; hostname?: string; signal?: AbortSignal; onListen?: (info: ServeInfo) => void; maxBodySize?: i64; headerTimeout?: i64; idleTimeout?: i64 };
type ServeHandler = (req: Request) => Promise<Response>;
// What serve's options settle for each connection, under a name no program can write.
type __serveLimits = { maxBodySize: i64; headerTimeout: i64; idleTimeout: i64 };
// A router's internal names take forms no program can write, so a program's own never hides
// the HTTP library.
type __routerNext = (req: Request) => Promise<Response>;
type __routerMiddleware = (req: Request, next: __routerNext) => Promise<Response>;
// Each route's method, split path, handler, whether it takes every path below its own, and the
// middleware of the routers mounted around it, outermost first, added together under one lock.
type __routerRoutes = { methods: string[]; paths: string[][]; handlers: ServeHandler[]; prefixes: boolean[]; groups: __routerMiddleware[][] };
// A router's routes and middleware, shared so each middleware's next can hold them.
type __routerTable = { routes: Lock<__routerRoutes>; middleware: Lock<__routerMiddleware[]> };

// Serves HTTP/1.1 on hostname and port, each connection on a task of its own.
async function serve(options: ServeOptions, handler: (req: Request) => Promise<Response>): Promise<void> throws IoError {
  let hostname = "0.0.0.0";
  const h = options.hostname;
  if (h !== null) hostname = h;
  let port: i64 = 8000;
  const p = options.port;
  if (p !== null) port = p;
  // Bun's 128 MiB body limit and 10 second idle timeout, and Node's minute for a request's head.
  const limits: __serveLimits = {
    maxBodySize: Http1.option(options.maxBodySize, 134217728, "maxBodySize", "bytes"),
    headerTimeout: Http1.option(options.headerTimeout, 60000, "headerTimeout", "milliseconds, or 0 for no timeout"),
    idleTimeout: Http1.option(options.idleTimeout, 10000, "idleTimeout", "milliseconds, or 0 for no timeout"),
  };
  // With no signal of its own, the server stops at the first SIGINT or SIGTERM.
  const given = options.signal;
  const stop = given ?? shutdownSignal();
  const live = shared({ count: new Atomic(0) });
  {
    // The listener closes as this block ends, so no one new waits while connections drain.
    const listener = await TcpListener.bind(hostname, port);
    const bound = listener.port;
    const listen = options.onListen;
    if (listen !== null) listen({ hostname: hostname, port: bound });
    const boxed: ServeHandler = handler;
    // A request with no Host header gets the server's address, an IPv6 one bracketed as in a URL.
    const host = (hostname.includes(":") ? "[" + hostname + "]" : hostname) + ":" + String(bound);
    while (true) {
      try {
        const conn = await listener.accept(stop);
        live.count.add(1);
        spawn(Http1.tracked(conn, boxed.clone(), host, stop.clone(), live.clone(), limits.clone()));
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

// One connection's requests, one after another while both sides keep it open. A request's head
// must arrive within headerTimeout of the connection opening or the last response, and with no
// byte of it yet the connection also closes after idleTimeout; a body must keep arriving, with
// no gap between reads longer than idleTimeout. A request that stalls once begun gets a 408.
async function serveConnection(conn: TcpStream, handler: ServeHandler, host: string, stop: AbortSignal, limits: __serveLimits): Promise<void> {
  let buffer: u8[] = [];
  try {
    while (true) {
      buffer = Http1.skipBlank(buffer);
      const headBy = Http1.after(limits.headerTimeout);
      const idleBy = Http1.after(limits.idleTimeout);
      let end = Http1.headEnd(buffer, 0);
      while (end < 0) {
        // A head may take 16 KiB.
        if ((buffer.length as i64) > 16384) { await Http1.refuse(conn, 431); return; }
        const started = buffer.length > 0;
        const got = await Http1.readBy(conn, stop, started ? headBy : Http1.sooner(headBy, idleBy));
        if (got === null) {
          if (started) await Http1.refuse(conn, 408);
          return;
        }
        if (got.length === 0) return;
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
      if (length > limits.maxBodySize) { await Http1.refuse(conn, 413); return; }
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
        const got = await Http1.readBy(conn, stop, Http1.after(limits.idleTimeout));
        if (got === null) { await Http1.refuse(conn, 408); return; }
        if (got.length === 0) return;
        for (const b of got) buffer.push(b);
      }
      // The buffer becomes the body, so a large one isn't copied; what came after it is kept.
      let body = buffer;
      buffer = body.splice(length);
      const keep = Http1.keepAlive(head);
      const method = head.method;
      const version = head.version;
      // While the handler runs, a watcher aborts the request's signal if the client goes away.
      const client = new AbortController();
      const signal = client.signal;
      const done = new AbortController();
      const watching = spawn(Http1.watch(conn.clone(), client, done.signal));
      // The body is set after, not passed in init, which would copy it.
      let req = new Request("http://" + authority + head.target, { method: method, headers: head.headers, signal: signal.clone() });
      req.body = body;
      // The handler runs as a task of its own, so a panic in it ends only that task: its client
      // gets a bare 500 and the connection closes, and the server goes on serving.
      let res: Response;
      try {
        res = await spawn(Http1.handle(handler.clone(), req)).join();
      } catch (e) {
        done.abort();
        await watching;
        await Http1.send(conn, new Response("", { status: 500 }), false, true, version);
        return;
      }
      const said = res.headers.get("connection");
      const close = !keep || stop.aborted || (said !== null && Http1.hasToken(said, "close"));
      // A streamed body is taken out of the response; one that won't be sent is dropped unstarted.
      const stream = res.__stream();
      if (stream !== null && Http1.sendable(res) && res.status !== 204 && res.status !== 304) {
        let pieces = stream;
        const open = await Http1.stream(conn, res, pieces, method === "HEAD", close, version, signal, stop);
        // The watcher holds the connection too, so it is stopped however the stream ended.
        done.abort();
        const early = await watching;
        if (!open) return;
        for (const b of early) buffer.push(b);
        continue;
      }
      done.abort();
      const early = await watching;
      for (const b of early) buffer.push(b);
      // A response that can't be sent as it stands, like a header value holding a line break,
      // goes out as a 500 instead.
      if (Http1.sendable(res)) await Http1.send(conn, res, method === "HEAD", close, version);
      else await Http1.send(conn, new Response("Internal Server Error\\n", { status: 500 }), false, close, version);
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
  private table: shared<__routerTable>;
  // The innermost next, which runs the routes. Holding a Dyn also keeps a Router from being
  // cloned, since clones would share one table.
  private inner: __routerNext;

  constructor() {
    // Named first: an empty array literal for a field of callables is typed 'never[]'.
    const handlers: ServeHandler[] = [];
    const groups: __routerMiddleware[][] = [];
    const routes: __routerRoutes = { methods: [], paths: [], handlers: handlers, prefixes: [], groups: groups };
    const middleware: __routerMiddleware[] = [];
    const table = shared<__routerTable>({ routes: new Lock<__routerRoutes>(routes), middleware: new Lock<__routerMiddleware[]>(middleware) });
    const held = table.clone();
    this.table = table;
    this.inner = Router.routing(held, 1);
  }

  // Routes a request from the first route, with no middleware but the routes' own groups', as
  // its depth-th re-route.
  private static routing(table: shared<__routerTable>, depth: i64): __routerNext {
    return async (r: Request) => {
      const res = await Router.dispatch(table.clone(), r, 0, depth);
      return res;
    };
  }

  // Wraps every route and the 404, whenever it is added; the first added runs outermost.
  use(this: Mut<this>, middleware: __routerMiddleware) { this.table.middleware.update((m) => { m.push(middleware); }); }

  get(this: Mut<this>, path: string, handler: ServeHandler) { this.add("GET", path, handler); }
  post(this: Mut<this>, path: string, handler: ServeHandler) { this.add("POST", path, handler); }
  put(this: Mut<this>, path: string, handler: ServeHandler) { this.add("PUT", path, handler); }
  patch(this: Mut<this>, path: string, handler: ServeHandler) { this.add("PATCH", path, handler); }
  delete(this: Mut<this>, path: string, handler: ServeHandler) { this.add("DELETE", path, handler); }
  // A route for every method.
  all(this: Mut<this>, path: string, handler: ServeHandler) { this.add("", path, handler); }

  // A route for a method, in any case, or a router mounted under a path prefix, as Hono's
  // app.route does: its routes join this one's in place, under the prefix, its middleware
  // running inside this one's for its routes alone.
  route(this: Mut<this>, method: string, path: string, handler: ServeHandler): void;
  route(this: Mut<this>, prefix: string, router: Router): void;
  route(this: Mut<this>, a: string, b: string | Router, ...handler: ServeHandler[]): void {
    if (typeof b !== "string") {
      this.mount(a, b);
      return;
    }
    for (const h of handler) this.add(a, b, h.clone());
  }

  // A path without a leading '/' gets one.
  private add(this: Mut<this>, method: string, path: string, handler: ServeHandler) {
    const upper = method.toUpperCase();
    const split = (path.startsWith("/") ? path : "/" + path).split("/");
    const none: __routerMiddleware[] = [];
    this.table.routes.update((t) => {
      t.methods.push(upper);
      t.paths.push(split);
      t.handlers.push(handler);
      t.prefixes.push(false);
      t.groups.push(none);
    });
  }

  // Adds each of a child's routes at its path below the prefix, the child's '/' being the prefix
  // itself. A static route's handler sees the path with the prefix taken off, as it would unmounted.
  private mount(this: Mut<this>, prefix: string, child: Router) {
    let base = (prefix.startsWith("/") ? prefix : "/" + prefix).split("/");
    if (base.length > 1 && base[base.length - 1] === "") base.pop();
    const drop = base.length as i64;
    const outer = child.table.middleware.update((all) => all.map((m) => m.clone()));
    const t = child.table.routes.update((t) => ({ methods: t.methods.clone(), paths: t.paths.clone(), handlers: t.handlers.map((h) => h.clone()), prefixes: t.prefixes.clone(), groups: t.groups.map((g) => g.map((m) => m.clone())) }));
    for (let i = 0; i < t.paths.length; i++) {
      const own = t.paths[i].clone();
      const path = own.length === 2 && own[1] === "" && drop > 1 ? base.clone() : base.concat(own.slice(1));
      let group = outer.map((m) => m.clone());
      for (const m of t.groups[i]) group.push(m.clone());
      let handler = t.handlers[i].clone();
      if (t.prefixes[i]) {
        const inner = handler;
        handler = async (r: Request) => {
          let moved = r;
          moved.path = "/" + moved.path.split("/").slice(drop).join("/");
          const res = await inner(moved);
          return res;
        };
      }
      const method = t.methods[i].clone();
      const prefixed = t.prefixes[i];
      this.table.routes.update((mine) => {
        mine.methods.push(method);
        mine.paths.push(path);
        mine.handlers.push(handler);
        mine.prefixes.push(prefixed);
        mine.groups.push(group);
      });
    }
  }

  // Serves the files under root at the paths below prefix, for GET and HEAD. A path that isn't
  // a readable regular file inside root, after symlinks are resolved, is answered 404.
  static(this: Mut<this>, prefix: string, root: string) {
    let split = (prefix.startsWith("/") ? prefix : "/" + prefix).split("/");
    if (split.length > 1 && split[split.length - 1] === "") split.pop();
    const skip = split.length;
    const none: __routerMiddleware[] = [];
    const handler: ServeHandler = async (req: Request) => {
      const res = await __staticResponse(req, skip, root.clone());
      return res;
    };
    this.table.routes.update((t) => {
      t.methods.push("GET");
      t.paths.push(split);
      t.handlers.push(handler);
      t.prefixes.push(true);
      t.groups.push(none);
    });
  }

  // The response the middleware give around the routes. Each next is built from the one inside
  // it, innermost first, so no call of the chain awaits itself.
  async handle(req: Request): Promise<Response> {
    // The route is found and its :params decoded once, before any middleware runs, so one that
    // isn't percent-encoded UTF-8 is refused before middleware sees the request.
    const path = req.path.clone();
    const method = req.method.clone();
    const have = path.split("/");
    const found = this.table.routes.update((t) => Router.find(t, method, have, 0));
    let handler: ServeHandler = async (r: Request) => new Response("Not Found\\n", { status: 404 });
    let params: string[] = [];
    let prefix = false;
    let after: usize = 0;
    let group: __routerMiddleware[] = [];
    if (found !== null) {
      const decoded = Router.decoded(found.params);
      if (decoded === null) return new Response("Bad Request\\n", { status: 400 });
      params = decoded;
      handler = found.handler;
      prefix = found.prefix;
      after = found.next;
      group = found.group;
    }
    const table = this.table.clone();
    // A middleware that changed the path or method has its request routed again.
    const again = this.inner.clone();
    let next: __routerNext = async (r: Request) => {
      if (r.path !== path || r.method !== method) {
        const res = await again(r);
        return res;
      }
      if (!prefix) {
        const res = await Router.run(handler.clone(), group.map((m) => m.clone()), params.clone(), again.clone(), r);
        return res;
      }
      // A static route's 404 is a miss, passed on to the routes after it.
      const res = await Router.run(handler.clone(), group.map((m) => m.clone()), params.clone(), again.clone(), r.clone());
      if (res.status !== 404) return res;
      const rest = await Router.dispatch(table.clone(), r, after, 0);
      return rest;
    };
    let chain = this.table.middleware.update((all) => all.map((m) => m.clone()));
    while (chain.length > 0) {
      const m = chain.pop()!;
      const inner = next;
      next = async (r: Request) => {
        const res = await m(r, inner.clone());
        return res;
      };
    }
    const res = await next(req);
    return res;
  }

  // The response of the first route from index start that matches; a HEAD request may run a GET
  // route, and a static route's 404 is a miss, passed on to the routes after it.
  // Group middleware that keep rewriting each other's paths are stopped with a 500 after a few
  // re-routes, before the recursion overflows the stack and takes the server down.
  private static async dispatch(table: shared<__routerTable>, req: Request, start: usize, depth: i64): Promise<Response> {
    if (depth > 10) return new Response("Internal Server Error\\n", { status: 500 });
    const have = req.path.split("/");
    const method = req.method.clone();
    let from = start;
    while (true) {
      const at = from;
      const found = table.routes.update((t) => Router.find(t, method, have, at));
      if (found === null) return new Response("Not Found\\n", { status: 404 });
      const params = Router.decoded(found.params);
      if (params === null) return new Response("Bad Request\\n", { status: 400 });
      const again = Router.routing(table.clone(), depth + 1);
      if (!found.prefix) {
        const res = await Router.run(found.handler, found.group, params, again, req);
        return res;
      }
      const res = await Router.run(found.handler, found.group, params, again, req.clone());
      if (res.status !== 404) return res;
      from = found.next;
    }
  }

  // The response of a route's handler inside the middleware of the routers mounted around it,
  // the first outermost. One of them that changes the path or method has the request routed again.
  private static async run(handler: ServeHandler, group: __routerMiddleware[], params: string[], again: __routerNext, req: Request): Promise<Response> {
    const path = req.path.clone();
    const method = req.method.clone();
    let next: __routerNext = async (r: Request) => {
      if (r.path !== path || r.method !== method) {
        const res = await again(r);
        return res;
      }
      let routed = r;
      routed.params = params.clone();
      const res = await handler(routed);
      return res;
    };
    let chain = group;
    while (chain.length > 0) {
      const m = chain.pop()!;
      const inner = next;
      next = async (r: Request) => {
        const res = await m(r, inner.clone());
        return res;
      };
    }
    const res = await next(req);
    return res;
  }

  // The first route from index start taking a method and path, its handler cloned, with the
  // :params it reads, whether it is a prefix route, and the index after it.
  private static find(t: Ref<__routerRoutes>, method: string, have: Ref<string[]>, start: usize): { handler: ServeHandler; params: string[]; prefix: boolean; next: usize; group: __routerMiddleware[] } | null {
    const head = method === "HEAD";
    for (let i = start; i < t.paths.length; i++) {
      const want = t.methods[i];
      if (want !== "" && want !== method && !(head && want === "GET")) continue;
      const found = Router.match(t.paths[i], have, t.prefixes[i]);
      if (found !== null) return { handler: t.handlers[i].clone(), params: found, prefix: t.prefixes[i], next: i + 1, group: t.groups[i].map((m) => m.clone()) };
    }
    return null;
  }

  // The router as the handler serve takes; the handler owns it.
  handler(this: Own<this>): ServeHandler {
    const router = this;
    return async (req: Request) => {
      const res = await router.handle(req);
      return res;
    };
  }

  // The :params with their values percent-decoded, or null when one doesn't decode.
  static decoded(params: Ref<string[]>): string[] | null {
    let out: string[] = [];
    for (let i: usize = 0; i + 1 < params.length; i += 2) {
      const value = __urlDecodeStrict(params[i + 1]);
      if (value === null) return null;
      out.push(params[i]);
      out.push(value);
    }
    return out;
  }

  // The :params a route's segments take from a path's, or null when they don't match. A prefix
  // route matches a path with more segments than its own.
  static match(want: Ref<string[]>, have: Ref<string[]>, prefix: boolean): string[] | null {
    if (prefix ? have.length < want.length : want.length !== have.length) return null;
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

// The response Router.static gives a request: the file below root its path names past the
// route's skip segments, a directory's index.html, or a 404 for anything else. Each segment is
// percent-decoded before it is checked, so an encoded slash, dot or NUL is refused like a plain one.
async function __staticResponse(req: Request, skip: usize, root: string): Promise<Response> {
  const segments = req.path.split("/");
  let parts: string[] = [];
  for (let i = skip; i < segments.length; i++) {
    const part = __urlDecodeStrict(segments[i]);
    if (part === null) return __staticMissing();
    // A trailing slash is kept, so it names only a directory; an empty segment anywhere else is
    // refused.
    if (part === "" && i + 1 === segments.length) {
      parts.push(part);
      continue;
    }
    // A leading dot refuses '.', '..' and hidden files such as '.env'.
    if (part === "" || part.startsWith(".") || part.includes("/") || part.includes("\\\\") || part.includes("\\0")) return __staticMissing();
    parts.push(part);
  }
  const found = await spawnBlocking(() => __staticFind(root, parts));
  if (found === null) return __staticMissing();
  const [path, size, mtime] = found;
  const tag = "W/\\"" + __staticHex(size) + "-" + __staticHex(mtime) + "\\"";
  let headers = new Headers();
  headers.set("etag", tag);
  headers.set("last-modified", new Date(mtime).toUTCString());
  const asked = req.headers.get("if-none-match");
  if (asked !== null && __staticMatches(asked, tag)) return new Response(null, { status: 304, headers: headers });
  headers.set("content-type", __staticType(path));
  try {
    const bytes = await fileRead(path);
    return new Response(bytes, { headers: headers });
  } catch (e) {
    return __staticMissing();
  }
}

function __staticMissing(): Response {
  return new Response("Not Found\\n", { status: 404 });
}

function __staticHex(n: i64): string {
  const digits = "0123456789abcdef";
  let out = "";
  let rest = n < 0 ? 0 : n;
  while (true) {
    out = digits[(rest % 16) as usize] + out;
    rest = rest / 16;
    if (rest === 0) return out;
  }
}

// The real path, size and modification time in milliseconds of the regular file root and parts
// name, or of the index.html of the directory they name, or null when there is none inside root.
// ponytail: the file is checked, then opened by its real path; a symlink swapped in between could
// still be followed, which opening each segment with O_NOFOLLOW would close.
function __staticFind(root: string, parts: Ref<string[]>): [string, i64, i64] | null {
  try {
    const base = pathReal(root);
    const inside = base.endsWith("/") ? base : base + "/";
    let path = inside + parts.join("/");
    let stat = pathStat(path, true);
    if (stat[3] === 2) {
      path = (path.endsWith("/") ? path : path + "/") + "index.html";
      stat = pathStat(path, true);
    }
    if (stat[3] !== 1) return null;
    const real = pathReal(path);
    if (!real.startsWith(inside)) return null;
    return [real, stat[0], Math.floor(stat[2]) as i64];
  } catch (e) {
    return null;
  }
}

// Whether an If-None-Match header names the ETag, compared weakly as RFC 9110 says for GET.
function __staticMatches(asked: string, tag: string): boolean {
  const strong = tag.slice(2);
  for (const each of asked.split(",")) {
    const t = each.trim();
    if (t === "*" || t === tag || t === strong) return true;
  }
  return false;
}

// The Content-Type for a file's extension, text types in UTF-8.
function __staticType(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const ext = dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
  const text = "; charset=utf-8";
  if (ext === "html" || ext === "htm") return "text/html" + text;
  if (ext === "css") return "text/css" + text;
  if (ext === "js" || ext === "mjs") return "text/javascript" + text;
  if (ext === "json" || ext === "map") return "application/json" + text;
  if (ext === "txt") return "text/plain" + text;
  if (ext === "md") return "text/markdown" + text;
  if (ext === "csv") return "text/csv" + text;
  if (ext === "xml") return "application/xml" + text;
  if (ext === "svg") return "image/svg+xml" + text;
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "avif") return "image/avif";
  if (ext === "ico") return "image/x-icon";
  if (ext === "woff") return "font/woff";
  if (ext === "woff2") return "font/woff2";
  if (ext === "ttf") return "font/ttf";
  if (ext === "otf") return "font/otf";
  if (ext === "pdf") return "application/pdf";
  if (ext === "wasm") return "application/wasm";
  if (ext === "zip") return "application/zip";
  if (ext === "mp4") return "video/mp4";
  if (ext === "webm") return "video/webm";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  return "application/octet-stream";
}

// The wire format of HTTP/1.x.
class Http1 {
  // A connection's requests, counted while it is open so the server can wait for it at shutdown.
  static async tracked(conn: TcpStream, handler: ServeHandler, host: string, stop: AbortSignal, live: shared<{ count: Atomic<i64> }>, limits: __serveLimits): Promise<void> {
    await serveConnection(conn, handler, host, stop, limits);
    live.count.sub(1);
  }

  // A serve option's value, or its default when it isn't given; serve refuses a negative one.
  static option(given: i64 | null, fallback: i64, name: string, unit: string): i64 throws IoError {
    if (given === null) return fallback;
    if (given < 0) throw new IoError("serve's " + name + " is " + String(given) + ", but it can't be negative; give it in " + unit);
    return given;
  }

  // The deadline ms from now, or 0, no deadline, for a timeout of 0.
  static after(ms: i64): i64 {
    return ms === 0 ? 0 : nowMs() + ms;
  }

  // The earlier of two deadlines, where 0 is none.
  static sooner(a: i64, b: i64): i64 {
    if (a === 0) return b;
    if (b === 0 || a < b) return a;
    return b;
  }

  static async handle(handler: ServeHandler, req: Request): Promise<Response> {
    return await handler(req);
  }

  // The client's next bytes, nothing once the stream ends or the server stops, or null once the
  // deadline passes. A deadline of 0 is none.
  static async readBy(conn: Ref<TcpStream>, stop: Ref<AbortSignal>, deadline: i64): Promise<u8[] | null> throws IoError {
    if (stop.aborted) return [];
    try {
      if (deadline === 0) return await conn.read(16384, stop.clone());
      const left = deadline - nowMs();
      if (left <= 0) return null;
      return await conn.read(16384, AbortSignal.any([stop.clone(), AbortSignal.timeout(left)]));
    } catch (e) {
      if (e instanceof IoError) throw e;
      if (stop.aborted) return [];
      return null;
    }
  }

  // Reads from the client while its request is handled and its response sent: the end of the
  // stream, or a broken connection, aborts the request's signal. Bytes that arrive are handed
  // back for the next request, and watching goes on past them, up to what one request may take.
  static async watch(conn: TcpStream, client: AbortController, done: AbortSignal): Promise<u8[]> {
    let early: u8[] = [];
    try {
      while ((early.length as i64) <= 16384 + 1048576) {
        const got = await conn.read(16384, done.clone());
        if (got.length === 0) {
          client.abort();
          return early;
        }
        for (const b of got) early.push(b);
      }
      // A client sending more than one request may take while waiting on this one can't be
      // served as it asks, so it is treated as gone, and watching stops.
      client.abort();
      return early;
    } catch (e) {
      if (e instanceof IoError) client.abort();
      return early;
    }
  }

  // Answers a request the server won't serve, and ends the connection.
  static async refuse(conn: Ref<TcpStream>, status: i64): Promise<void> throws IoError | AbortError {
    const res = new Response(Http1.reasonPhrase(status) + "\\n", { status: status });
    await Http1.send(conn, res, false, true, "HTTP/1.1");
  }

  // Writes a response. A small body goes out in one write with its head, since a second small
  // write can wait on the client's delayed ACK; a large one is written as it is, not copied.
  static async send(conn: Ref<TcpStream>, res: Response, head: boolean, close: boolean, version: string): Promise<void> throws IoError | AbortError {
    let out = new TextEncoder().encode(Http1.responseText(res, head, close, version));
    const sends = !head && res.status !== 204 && res.status !== 304;
    if (!sends || res.body.length <= 16384) {
      if (sends) for (const b of res.body) out.push(b);
      await conn.write(out, AbortSignal.timeout(30000));
      return;
    }
    await conn.write(out, AbortSignal.timeout(30000));
    await conn.write(res.body, AbortSignal.timeout(30000));
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

  // The bytes from start to end, as a new array, for heads and other small pieces; a body is
  // split off its buffer with splice instead of copied.
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
    const headers = Http1.parseFields(lines);
    if (headers === null) return null;
    return new HttpHead(parts[0], parts[1], version, headers);
  }

  // The header lines after a head's first, or null when one isn't a header.
  static parseFields(lines: Ref<string[]>): Headers | null {
    let headers = new Headers();
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const colon = line.indexOf(":");
      if (colon <= 0 || Http1.hasBreak(line)) return null;
      const name = line.slice(0, colon);
      if (!Http1.isToken(name)) return null;
      headers.append(name, line.slice(colon + 1).trim());
    }
    return headers;
  }

  // A request's line, headers and body, as fetch sends it: the caller's headers in their order,
  // the framing and Host its own.
  static requestBytes(req: Ref<Request>, authority: string, path: string): u8[] throws IoError {
    if (!Http1.isToken(req.method)) throw new IoError("can't fetch '" + req.url + "': '" + req.method + "' isn't a method name");
    let text = req.method + " " + path + " HTTP/1.1\\r\\nhost: " + authority + "\\r\\n";
    let bad = "";
    req.headers.forEach((value: string, name: string) => {
      if (!Http1.isToken(name) || Http1.hasBreak(value)) bad = name;
      else if (name !== "host" && name !== "connection" && name !== "content-length" && name !== "transfer-encoding") text = text + name + ": " + value + "\\r\\n";
    });
    if (bad.length > 0) throw new IoError("can't fetch '" + req.url + "': header '" + bad + "' holds a line break or isn't a header name");
    if (!req.headers.has("accept")) text = text + "accept: */*\\r\\n";
    if (!req.headers.has("user-agent")) text = text + "user-agent: fish\\r\\n";
    const size = req.body.length as i64;
    if (size > 0 || req.method === "POST" || req.method === "PUT" || req.method === "PATCH") text = text + "content-length: " + String(size) + "\\r\\n";
    let out = new TextEncoder().encode(text + "connection: close\\r\\n\\r\\n");
    for (const b of req.body) out.push(b);
    return out;
  }

  // The next bytes of a response, which must come before the connection ends.
  static async more(conn: Ref<TcpStream>, signal: Ref<AbortSignal>, before: string): Promise<u8[]> throws IoError | AbortError {
    const got = await conn.read(16384, signal.clone());
    if (got.length === 0) throw new IoError("the connection closed before " + before);
    return got;
  }

  // A response read whole from a connection that closes after it. Interim 1xx responses are
  // skipped; the body is framed by chunks, by Content-Length, or by the connection's end.
  static async receive(conn: TcpStream, head: boolean, signal: AbortSignal): Promise<Response> throws IoError | AbortError {
    let buffer: u8[] = [];
    while (true) {
      let end = Http1.headEnd(buffer, 0);
      while (end < 0) {
        if ((buffer.length as i64) > 65536) throw new IoError("the response's status line and headers are over 64 KiB");
        const from = buffer.length as i64 - 3;
        const got = await Http1.more(conn, signal, "the response's headers ended");
        for (const b of got) buffer.push(b);
        end = Http1.headEnd(buffer, from < 0 ? 0 : from);
      }
      if (end > 65536) throw new IoError("the response's status line and headers are over 64 KiB");
      const lines = new TextDecoder().decode(Http1.take(buffer, 0, end)).split("\\r\\n");
      buffer = Http1.take(buffer, end + 4, buffer.length as i64);
      const parts = lines[0].split(" ");
      const status = parts.length >= 2 ? Http1.digits(parts[1]) : -1;
      if (!lines[0].startsWith("HTTP/1.") || status < 100 || status > 999 || parts[1].length !== 3 || Http1.hasBreak(lines[0])) {
        throw new IoError("the response's status line '" + lines[0] + "' isn't HTTP/1.x");
      }
      const headers = Http1.parseFields(lines);
      if (headers === null) throw new IoError("the response's headers are malformed");
      if (status < 200 && status !== 101) continue;
      let body: u8[] = [];
      const coding = headers.get("transfer-encoding");
      if (head || status < 200 || status === 204 || status === 304) {
        body = [];
      } else if (coding !== null && Http1.hasToken(coding, "chunked")) {
        body = await Http1.chunked(conn, buffer, signal);
      } else if (coding === null && headers.has("content-length")) {
        const length = Http1.contentLength(headers);
        if (length < 0) throw new IoError("the response's Content-Length isn't a number");
        while ((buffer.length as i64) < length) {
          const got = await Http1.more(conn, signal, "the response's body ended");
          for (const b of got) buffer.push(b);
        }
        body = buffer;
        body.splice(length);
      } else {
        body = buffer;
        while (true) {
          const got = await conn.read(16384, signal.clone());
          if (got.length === 0) break;
          for (const b of got) body.push(b);
        }
      }
      let res = new Response(null, { status: status, statusText: lines[0].split(" ").slice(2).join(" "), headers: headers });
      res.body = body;
      return res;
    }
  }

  // A chunked body, decoded; trailers after the last chunk are left unread.
  static async chunked(conn: Ref<TcpStream>, start: u8[], signal: Ref<AbortSignal>): Promise<u8[]> throws IoError | AbortError {
    let buffer = start;
    let body: u8[] = [];
    let at: i64 = 0;
    while (true) {
      // The scan goes on from where the last read ended, and a size line may take 1 KiB.
      let line = Http1.lineEnd(buffer, at);
      while (line < 0) {
        if ((buffer.length as i64) - at > 1024) throw new IoError("the response's chunk size line is over 1 KiB");
        const from = buffer.length as i64 - 1;
        const got = await Http1.more(conn, signal, "the response's chunked body ended");
        for (const b of got) buffer.push(b);
        line = Http1.lineEnd(buffer, from < at ? at : from);
      }
      if (line - at > 1024) throw new IoError("the response's chunk size line is over 1 KiB");
      let sizeText = new TextDecoder().decode(Http1.take(buffer, at, line));
      const ext = sizeText.indexOf(";");
      if (ext >= 0) sizeText = sizeText.slice(0, ext);
      const size = Http1.hex(sizeText.trim());
      if (size < 0) throw new IoError("the response's chunk size '" + sizeText + "' isn't a hexadecimal number");
      at = line + 2;
      if (size === 0) return body;
      while ((buffer.length as i64) < at + size + 2) {
        const got = await Http1.more(conn, signal, "the response's chunked body ended");
        for (const b of got) buffer.push(b);
      }
      if (buffer[(at + size) as usize] !== 13 || buffer[(at + size + 1) as usize] !== 10) throw new IoError("the response's chunk of " + String(size) + " bytes isn't followed by CR LF");
      for (let i = at as usize; i < ((at + size) as usize); i++) body.push(buffer[i]);
      at = at + size + 2;
    }
  }

  // Where the line starting at from ends: the index of its CR LF, or -1.
  static lineEnd(buffer: Ref<u8[]>, from: i64): i64 {
    for (let i = from as usize; i + 1 < buffer.length; i++) {
      if (buffer[i] === 13 && buffer[i + 1] === 10) return i as i64;
    }
    return -1;
  }

  // A whole number written in hexadecimal digits, or -1.
  static hex(text: string): i64 {
    if (text.length === 0 || text.length > 15) return -1;
    let n: i64 = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i) as i64;
      const d = c >= 48 && c <= 57 ? c - 48 : c >= 97 && c <= 102 ? c - 87 : c >= 65 && c <= 70 ? c - 55 : -1;
      if (d < 0) return -1;
      n = n * 16 + d;
    }
    return n;
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
  // or list of hosts, and a host and port the URL parser takes, so the request's URL parses.
  static isHost(text: string): boolean {
    if (text.length === 0) return false;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i) as i64;
      if (c <= 32 || c === 47 || c === 63 || c === 35 || c === 64 || c === 44 || c === 92 || c === 127) return false;
    }
    let url = __urlEmpty();
    return __urlHostPort(__urlPoints(text), url, true).length === 0;
  }

  // Whether a response can go out as it stands: a status the Fetch API allows, and a status
  // text and headers that can't break into lines of their own.
  static sendable(res: Ref<Response>): boolean {
    if (res.status < 200 || res.status > 599 || Http1.hasBreak(res.statusText)) return false;
    let fine = true;
    res.headers.forEach((value: string, name: string) => {
      if (!Http1.isToken(name) || Http1.hasBreak(value)) fine = false;
    });
    for (const line of res.cookies.toSetCookieHeaders()) if (Http1.hasBreak(line)) fine = false;
    return fine;
  }

  // A response's status line and headers, as sent.
  // The server frames the body itself, so a handler's own framing headers are left out; 204
  // and 304 have no body at all.
  static responseText(res: Ref<Response>, head: boolean, close: boolean, version: string): string {
    const bodiless = res.status === 204 || res.status === 304;
    let framing = "";
    if (!bodiless) framing = "content-length: " + String(res.body.length as i64) + "\\r\\n";
    return Http1.headText(res, framing, close, version);
  }

  // A response's status line and headers, framing its body as the framing header says.
  static headText(res: Ref<Response>, framing: string, close: boolean, version: string): string {
    let reason = res.statusText;
    if (reason.length === 0) reason = Http1.reasonPhrase(res.status);
    let text = "HTTP/1.1 " + String(res.status) + " " + reason + "\\r\\n";
    res.headers.forEach((value: string, name: string) => {
      if (name !== "content-length" && name !== "transfer-encoding" && name !== "connection" && name !== "date") text = text + name + ": " + value + "\\r\\n";
    });
    // Never folded into one line, since an Expires date holds a comma.
    for (const line of res.cookies.toSetCookieHeaders()) text = text + "set-cookie: " + line + "\\r\\n";
    text = text + framing + "date: " + httpDate() + "\\r\\n";
    if (close) text = text + "connection: close\\r\\n";
    else if (version === "HTTP/1.0") text = text + "connection: keep-alive\\r\\n";
    return text + "\\r\\n";
  }

  // Sends a response with a streamed body: its head, then each piece as its generator makes it,
  // a chunk apiece to an HTTP/1.1 client and closed-delimited to a 1.0 one, which has no chunks.
  // The server stopping ends the body cleanly at the generator's next await or yield. The
  // client's end of the stream, as Node's server takes it, ends it there with nothing more
  // written, as does a write that fails or times out: a half-closed client and one that has gone
  // look the same. Whether the connection may serve another request.
  static async stream(conn: Ref<TcpStream>, res: Ref<Response>, pieces: Mut<Dyn<AsyncGenerator<string>>>, head: boolean, close: boolean, version: string, client: Ref<AbortSignal>, stop: Ref<AbortSignal>): Promise<boolean> {
    const chunked = version === "HTTP/1.1";
    const framing = chunked ? "transfer-encoding: chunked\\r\\n" : "";
    const started = await Http1.put(conn, Http1.headText(res, framing, close || !chunked, version), stop);
    if (!started) return false;
    if (head) return chunked && !close;
    while (!stop.aborted) {
      const piece = await Promise.race([Http1.next(pieces), Http1.abortOf(client), Http1.abortOf(stop)]);
      if (client.aborted) return false;
      if (piece === null) break;
      if (piece.length === 0) continue;
      const size = new TextEncoder().encode(piece).length as i64;
      const framed = chunked ? Http1.hexOf(size) + "\\r\\n" + piece + "\\r\\n" : piece;
      const sent = await Http1.put(conn, framed, stop);
      if (!sent) return false;
    }
    if (!chunked) return false;
    const sent = await Http1.put(conn, "0\\r\\n\\r\\n", stop);
    return sent && !close && !stop.aborted;
  }

  // Whether text was written within 30 seconds, and within a second of the server stopping.
  static async put(conn: Ref<TcpStream>, text: string, stop: Ref<AbortSignal>): Promise<boolean> {
    const sent = await Promise.race([Http1.written(conn, text), Http1.late(30000), Http1.graced(stop)]);
    return sent;
  }

  static async written(conn: Ref<TcpStream>, text: string): Promise<boolean> {
    try {
      await conn.write(new TextEncoder().encode(text));
      return true;
    } catch (e) {
      return false;
    }
  }

  // False, a second after the server stops.
  static async graced(stop: Ref<AbortSignal>): Promise<boolean> {
    await Http1.abortOf(stop);
    await sleep(1000);
    return false;
  }

  // False, once ms have passed.
  static async late(ms: i64): Promise<boolean> {
    await sleep(ms);
    return false;
  }

  // A stream's next piece, or null once it ends.
  static async next(pieces: Mut<Dyn<AsyncGenerator<string>>>): Promise<string | null> {
    const r = await pieces.next();
    if (r.done === false) return r.value;
    return null;
  }

  // Null once the signal aborts.
  static async abortOf(signal: Ref<AbortSignal>): Promise<string | null> {
    while (!signal.aborted) {
      try {
        await sleep(86400000, signal.clone());
      } catch (e) {}
    }
    return null;
  }

  // A count in hexadecimal digits, as a chunk's size is written.
  static hexOf(n: i64): string {
    const digits = "0123456789abcdef";
    let text = "";
    let left = n;
    while (true) {
      text = digits.charAt(left & 15) + text;
      left = left >> 4;
      if (left === 0) return text;
    }
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
      case 408 => "Request Timeout",
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

// fetch, whose URLs the URL library's parser reads.
const FETCH = `
// Fetches a URL over HTTP/1.1, one connection per request, as the Fetch API does: a 4xx or 5xx
// is a response, not an error, and a redirect is returned rather than followed.
async function fetch(input: string | Request | URL, init?: RequestInit): Promise<Response> throws IoError | AbortError {
  const req = __urlFetchRequest(input, init);
  const signal = req.signal.clone();
  const to = __urlFetchAddress(req.url);
  const sent = Http1.requestBytes(req, to.authority, to.path);
  const conn = await TcpStream.connect(to.host, to.port, signal.clone());
  await conn.write(sent, signal.clone());
  let res = await Http1.receive(conn, req.method === "HEAD", signal);
  res.url = to.url;
  return res;
}

// fetch's request: a Request given, with what init sets in place of its own.
function __urlFetchRequest(input: string | Request | URL, init?: RequestInit): Request {
  if (typeof input === "string") return new Request(input, init);
  if (input instanceof URL) return new Request(input.href, init);
  let req = input;
  if (init !== null) {
    const m = init.method;
    if (m !== null) req.method = m.toUpperCase();
    const h = init.headers;
    if (h !== null) req.headers = h;
    const b = init.body;
    if (b !== null) req.body = __httpBody(b);
    const s = init.signal;
    if (s !== null) req.signal = s;
  }
  return req;
}

// Where an http: URL points: host and port to connect to, the Host header, the path and query
// sent, and the URL without its fragment.
function __urlFetchAddress(url: string): { host: string; port: i64; authority: string; path: string; url: string } throws IoError {
  const parsed = __urlFetchTarget(url);
  if (typeof parsed === "string") throw new IoError("can't fetch '" + url + "': " + parsed);
  const authority = parsed.port >= 0 ? parsed.host + ":" + String(parsed.port) : parsed.host.clone();
  const query = parsed.hasQuery ? "?" + parsed.query : "";
  // An IPv6 host connects without the brackets it has in the URL and the Host header.
  const host = parsed.host.startsWith("[") ? parsed.host.slice(1, (parsed.host.length as i64) - 1) : parsed.host.clone();
  return { host: host, port: parsed.port >= 0 ? parsed.port : 80, authority: authority, path: __urlPathText(parsed) + query, url: __urlHref(parsed, parsed.hasQuery ? parsed.query.clone() : null, false) };
}
`;

// A request's path in a program without the URL library, whose requests all come from the server.
const SERVED = String.raw`
// A request's path, read with the parser's path rules from its URL as the server writes it:
// "http://", a Host header the server checked, and a target starting with '/'.
function __urlRequestPath(url: string): string {
  const input = __urlInput(url);
  let p: i64 = 7;
  while (p < (input.length as i64) && input[p as usize] !== 47) p++;
  let record = __urlEmpty();
  record.scheme = "http";
  const begun: u8[] = [];
  __urlReadPath(input, p + 1, record, begun, true);
  return __urlPathText(record);
}
`;

// The URL Standard's pieces the HTTP server reads requests with: hosts, paths and decoding.
const URL_CORE = String.raw`
// The URL Standard's URL record, as the parser builds it. A part that may be missing has a flag
// saying whether it is there; a port of -1 is none.
type __urlRecord = { scheme: string; username: string; password: string; host: string; hasHost: boolean; port: i64; path: string[]; opaque: boolean; query: string; hasQuery: boolean; fragment: string; hasFragment: boolean };

function __urlEmpty(): __urlRecord {
  const path: string[] = [];
  return { scheme: "", username: "", password: "", host: "", hasHost: false, port: -1, path: path, opaque: false, query: "", hasQuery: false, fragment: "", hasFragment: false };
}

// A string's code points, read from its bytes in one pass, a lone surrogate as U+FFFD, as a URL
// reads its input.
function __urlPoints(s: string): i64[] {
  const bytes = new TextEncoder().encode(s);
  const n = bytes.length;
  let out: i64[] = [];
  out.reserve(n as i64);
  let i: usize = 0;
  while (i < n) {
    const b = bytes[i] as i64;
    let c = b;
    let k: usize = 1;
    if (b >= 0xF0 && i + 3 < n) {
      c = ((b & 7) << 18) | (((bytes[i + 1] as i64) & 63) << 12) | (((bytes[i + 2] as i64) & 63) << 6) | ((bytes[i + 3] as i64) & 63);
      k = 4;
    } else if (b >= 0xE0 && i + 2 < n) {
      c = ((b & 15) << 12) | (((bytes[i + 1] as i64) & 63) << 6) | ((bytes[i + 2] as i64) & 63);
      k = 3;
    } else if (b >= 0xC0 && i + 1 < n) {
      c = ((b & 31) << 6) | ((bytes[i + 1] as i64) & 63);
      k = 2;
    }
    out.push(c >= 0xD800 && c <= 0xDFFF ? 0xFFFD : c);
    i += k;
  }
  return out;
}

function __urlAt(points: Ref<i64[]>, i: i64): i64 {
  return i >= 0 && i < (points.length as i64) ? points[i as usize] : -1;
}

function __urlDefaultPort(scheme: string): i64 {
  if (scheme === "http" || scheme === "ws") return 80;
  if (scheme === "https" || scheme === "wss") return 443;
  if (scheme === "ftp") return 21;
  return -1;
}

function __urlAlpha(c: i64): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function __urlDigit(c: i64): boolean {
  return c >= 48 && c <= 57;
}

function __urlHexValue(c: i64): i64 {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 97 && c <= 102) return c - 87;
  if (c >= 65 && c <= 70) return c - 55;
  return -1;
}

// Whether a percent-encode set of the URL Standard holds a code point.
function __urlInSet(c: i64, set: string): boolean {
  if (set === "none") return false;
  if (set === "form") return true;
  if (c < 32 || c > 126) return true;
  if (set === "c0") return false;
  if (set === "fragment") return c === 32 || c === 34 || c === 60 || c === 62 || c === 96;
  // The query set, then those adding to it.
  if (c === 32 || c === 34 || c === 35 || c === 60 || c === 62) return true;
  if (set === "query") return false;
  if (set === "specialQuery") return c === 39;
  if (c === 63 || c === 94 || c === 96 || c === 123 || c === 125) return true;
  if (set === "path") return false;
  return c === 47 || c === 58 || c === 59 || c === 61 || c === 64 || (c >= 91 && c <= 93) || c === 124;
}

// Appends a code point to UTF-8 bytes, percent-encoded when the set holds it. Output is built
// as bytes and made a string once, so a URL is read in linear time.
function __urlPut(out: Mut<u8[]>, c: i64, set: string) {
  const escape = __urlInSet(c, set);
  if (c < 0x80) __urlPutByte(out, c, escape);
  else if (c < 0x800) {
    __urlPutByte(out, 0xC0 | (c >> 6), escape);
    __urlPutByte(out, 0x80 | (c & 63), escape);
  } else if (c < 0x10000) {
    __urlPutByte(out, 0xE0 | (c >> 12), escape);
    __urlPutByte(out, 0x80 | ((c >> 6) & 63), escape);
    __urlPutByte(out, 0x80 | (c & 63), escape);
  } else {
    __urlPutByte(out, 0xF0 | (c >> 18), escape);
    __urlPutByte(out, 0x80 | ((c >> 12) & 63), escape);
    __urlPutByte(out, 0x80 | ((c >> 6) & 63), escape);
    __urlPutByte(out, 0x80 | (c & 63), escape);
  }
}

function __urlPutByte(out: Mut<u8[]>, b: i64, escape: boolean) {
  if (!escape) {
    out.push(b as u8);
    return;
  }
  const high = b >> 4;
  const low = b & 15;
  out.push(37);
  out.push((high < 10 ? 48 + high : 55 + high) as u8);
  out.push((low < 10 ? 48 + low : 55 + low) as u8);
}

// Bytes with each '%' and two hex digits read as the byte they name.
function __urlPercentDecode(bytes: Ref<u8[]>): u8[] {
  let out: u8[] = [];
  let i: usize = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === 37 && i + 2 < bytes.length + 0 && __urlHexValue(bytes[i + 1] as i64) >= 0 && __urlHexValue(bytes[i + 2] as i64) >= 0) {
      out.push((__urlHexValue(bytes[i + 1] as i64) * 16 + __urlHexValue(bytes[i + 2] as i64)) as u8);
      i += 3;
    } else {
      out.push(b);
      i += 1;
    }
  }
  return out;
}

// UTF-8 bytes as text, each malformed sequence as U+FFFD, and a leading byte order mark kept.
function __urlText(bytes: Ref<u8[]>): string {
  const bom = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
  const text = new TextDecoder().decode(bytes);
  return bom ? "\u{FEFF}" + text : text;
}

// Whether a string is a Windows drive letter: a letter, then ':' or, unless normalized, '|'.
function __urlDrive(s: string, normalized: boolean): boolean {
  if (s.length !== 2 || !__urlAlpha(s.charCodeAt(0) as i64)) return false;
  const c = s.charCodeAt(1) as i64;
  return c === 58 || (!normalized && c === 124);
}

// Drops a path's last segment, except a file URL's drive letter.
function __urlShorten(url: Mut<__urlRecord>) {
  if (url.scheme === "file" && url.path.length === 1 && __urlDrive(url.path[0], true)) return;
  url.path.pop();
}

function __urlSingleDot(s: string): boolean {
  return s === "." || s.toLowerCase() === "%2e";
}

function __urlDoubleDot(s: string): boolean {
  const l = s.toLowerCase();
  return l === ".." || l === ".%2e" || l === "%2e." || l === "%2e%2e";
}

// A host as the parser makes it, or an error saying why there is none.
type __urlHost = { host: string; error: string };

function __urlHostOf(points: Ref<i64[]>, special: boolean): __urlHost {
  const failed = { host: "", error: "Invalid URL" };
  const n = points.length as i64;
  if (n > 0 && points[0] === 91) {
    if (points[(n - 1) as usize] !== 93) return failed;
    const address = __urlIpv6(points.slice(1, n - 1));
    if (address.length === 0) return failed;
    return { host: "[" + __urlIpv6Text(address) + "]", error: "" };
  }
  let raw: u8[] = [];
  for (const c of points) {
    if (!special && __urlForbiddenHost(c)) return failed;
    __urlPut(raw, c, special ? "none" : "c0");
  }
  if (!special) return { host: __urlText(raw), error: "" };
  const decoded = __urlPercentDecode(raw);
  const domain = __urlText(decoded);
  for (const c of __urlPoints(domain)) {
    if (c > 127) return { host: "", error: "Invalid URL: international domain names aren't supported yet" };
  }
  const ascii = domain.toLowerCase();
  for (const label of ascii.split(".")) {
    if (label.startsWith("xn--")) return { host: "", error: "Invalid URL: international domain names aren't supported yet" };
  }
  if (ascii.length === 0) return failed;
  for (const c of __urlPoints(ascii)) {
    if (__urlForbiddenHost(c) || c <= 31 || c === 37 || c === 127) return failed;
  }
  if (__urlEndsInNumber(ascii)) {
    const v4 = __urlIpv4(ascii);
    if (v4 < 0) return failed;
    return { host: __urlIpv4Text(v4), error: "" };
  }
  return { host: ascii, error: "" };
}

function __urlForbiddenHost(c: i64): boolean {
  return c === 0 || c === 9 || c === 10 || c === 13 || c === 32 || c === 35 || c === 47 || c === 58 || c === 60 || c === 62 || c === 63 || c === 64 || c === 91 || c === 92 || c === 93 || c === 94 || c === 124;
}

// Whether a domain's last label is a number, which makes the domain an IPv4 address.
function __urlEndsInNumber(domain: string): boolean {
  let parts = domain.split(".");
  if (parts[parts.length - 1].length === 0) {
    if (parts.length === 1) return false;
    parts.pop();
  }
  const last = parts[parts.length - 1];
  if (last.length === 0) return false;
  let digits = true;
  for (let i = 0; i < last.length; i++) {
    if (!__urlDigit(last.charCodeAt(i) as i64)) digits = false;
  }
  return digits || __urlIpv4Number(last) >= 0;
}

// A part of an IPv4 address in decimal, octal after '0' or hexadecimal after '0x', or -1.
// Values past 2^40 stay there, as any of them is too large.
function __urlIpv4Number(text: string): i64 {
  if (text.length === 0) return -1;
  let radix: i64 = 10;
  let digits = text;
  if (text.startsWith("0x") || text.startsWith("0X")) {
    radix = 16;
    digits = text.slice(2);
  } else if (text.length >= 2 && text.startsWith("0")) {
    radix = 8;
    digits = text.slice(1);
  }
  let n: i64 = 0;
  for (let i = 0; i < digits.length; i++) {
    const d = __urlHexValue(digits.charCodeAt(i) as i64);
    if (d < 0 || d >= radix) return -1;
    if (n < 1099511627776) n = n * radix + d;
  }
  return n;
}

// An IPv4 address as a number, or -1.
function __urlIpv4(text: string): i64 {
  let parts = text.split(".");
  if (parts[parts.length - 1].length === 0 && parts.length > 1) parts.pop();
  if (parts.length > 4) return -1;
  let numbers: i64[] = [];
  for (const part of parts) {
    const n = __urlIpv4Number(part);
    if (n < 0) return -1;
    numbers.push(n);
  }
  const count = numbers.length as i64;
  for (let i: i64 = 0; i + 1 < count; i++) {
    if (numbers[i as usize] > 255) return -1;
  }
  const last = numbers[(count - 1) as usize];
  let limit: i64 = 1;
  for (let i: i64 = 0; i < 5 - count; i++) limit = limit * 256;
  if (last >= limit) return -1;
  let address = last;
  let scale: i64 = 16777216;
  for (let i: i64 = 0; i + 1 < count; i++) {
    address = address + numbers[i as usize] * scale;
    scale = scale / 256;
  }
  return address;
}

function __urlIpv4Text(address: i64): string {
  return String(address >> 24) + "." + String((address >> 16) & 255) + "." + String((address >> 8) & 255) + "." + String(address & 255);
}

// An IPv6 address's eight pieces, or none when the text isn't one.
function __urlIpv6(input: Ref<i64[]>): i64[] {
  const none: i64[] = [];
  let address: i64[] = [0, 0, 0, 0, 0, 0, 0, 0];
  let piece: i64 = 0;
  let compress: i64 = -1;
  let p: i64 = 0;
  if (__urlAt(input, p) === 58) {
    if (__urlAt(input, p + 1) !== 58) return none;
    p += 2;
    piece++;
    compress = piece;
  }
  while (__urlAt(input, p) !== -1) {
    if (piece === 8) return none;
    if (__urlAt(input, p) === 58) {
      if (compress !== -1) return none;
      p++;
      piece++;
      compress = piece;
      continue;
    }
    let value: i64 = 0;
    let length: i64 = 0;
    while (length < 4 && __urlHexValue(__urlAt(input, p)) >= 0) {
      value = value * 16 + __urlHexValue(__urlAt(input, p));
      p++;
      length++;
    }
    if (__urlAt(input, p) === 46) {
      if (length === 0) return none;
      p -= length;
      if (piece > 6) return none;
      let seen: i64 = 0;
      while (__urlAt(input, p) !== -1) {
        let v4: i64 = -1;
        if (seen > 0) {
          if (__urlAt(input, p) === 46 && seen < 4) p++;
          else return none;
        }
        if (!__urlDigit(__urlAt(input, p))) return none;
        while (__urlDigit(__urlAt(input, p))) {
          const d = __urlAt(input, p) - 48;
          if (v4 === -1) v4 = d;
          else if (v4 === 0) return none;
          else v4 = v4 * 10 + d;
          if (v4 > 255) return none;
          p++;
        }
        address[piece as usize] = address[piece as usize] * 256 + v4;
        seen++;
        if (seen === 2 || seen === 4) piece++;
      }
      if (seen !== 4) return none;
      break;
    } else if (__urlAt(input, p) === 58) {
      p++;
      if (__urlAt(input, p) === -1) return none;
    } else if (__urlAt(input, p) !== -1) return none;
    address[piece as usize] = value;
    piece++;
  }
  if (compress !== -1) {
    let swaps = piece - compress;
    piece = 7;
    while (piece !== 0 && swaps > 0) {
      const held = address[piece as usize];
      address[piece as usize] = address[(compress + swaps - 1) as usize];
      address[(compress + swaps - 1) as usize] = held;
      piece--;
      swaps--;
    }
  } else if (piece !== 8) return none;
  return address;
}

// An IPv6 address written with its longest run of zero pieces, if two or more, as '::'.
function __urlIpv6Text(address: Ref<i64[]>): string {
  let compress: i64 = -1;
  let best: i64 = 1;
  let i: i64 = 0;
  while (i < 8) {
    let j = i;
    while (j < 8 && address[j as usize] === 0) j++;
    if (j - i > best) {
      best = j - i;
      compress = i;
    }
    i = j > i ? j : i + 1;
  }
  const digits = "0123456789abcdef";
  let out = "";
  let skipping = false;
  for (let k: i64 = 0; k < 8; k++) {
    const v = address[k as usize];
    if (skipping && v === 0) continue;
    skipping = false;
    if (compress === k) {
      out = out + (k === 0 ? "::" : ":");
      skipping = true;
      continue;
    }
    let hex = "";
    let n = v;
    while (true) {
      hex = digits.charAt(n & 15) + hex;
      n = n >> 4;
      if (n === 0) break;
    }
    out = out + hex;
    if (k !== 7) out = out + ":";
  }
  return out;
}

// Percent-encoded UTF-8 decoded, as decodeURIComponent does, or null for a '%' without two hex
// digits after it or bytes that aren't UTF-8.
function __urlDecodeStrict(text: string): string | null {
  const bytes = new TextEncoder().encode(text);
  let out: u8[] = [];
  let i: usize = 0;
  while (i < bytes.length) {
    if (bytes[i] !== 37) {
      out.push(bytes[i]);
      i += 1;
      continue;
    }
    if (i + 2 >= bytes.length + 0 || __urlHexValue(bytes[i + 1] as i64) < 0 || __urlHexValue(bytes[i + 2] as i64) < 0) return null;
    out.push((__urlHexValue(bytes[i + 1] as i64) * 16 + __urlHexValue(bytes[i + 2] as i64)) as u8);
    i += 3;
  }
  if (!__urlUtf8Valid(out)) return null;
  return new TextDecoder().decode(out);
}

// Whether bytes are well-formed UTF-8: no overlong forms, surrogates or code points past U+10FFFF.
function __urlUtf8Valid(bytes: Ref<u8[]>): boolean {
  const n = bytes.length as i64;
  let i: i64 = 0;
  while (i < n) {
    const b = bytes[i as usize] as i64;
    let need: i64 = 0;
    let low: i64 = 0x80;
    let high: i64 = 0xBF;
    if (b < 0x80) need = 0;
    else if (b >= 0xC2 && b <= 0xDF) need = 1;
    else if (b === 0xE0) { need = 2; low = 0xA0; }
    else if (b === 0xED) { need = 2; high = 0x9F; }
    else if (b >= 0xE1 && b <= 0xEF) need = 2;
    else if (b === 0xF0) { need = 3; low = 0x90; }
    else if (b === 0xF4) { need = 3; high = 0x8F; }
    else if (b >= 0xF1 && b <= 0xF3) need = 3;
    else return false;
    if (i + need >= n) return false;
    for (let k: i64 = 1; k <= need; k++) {
      const c = bytes[(i + k) as usize] as i64;
      if (c < (k === 1 ? low : 0x80) || c > (k === 1 ? high : 0xBF)) return false;
    }
    i += need + 1;
  }
  return true;
}

// A URL's path as its pathname gives it.
function __urlPathText(url: Ref<__urlRecord>): string {
  if (url.opaque) return url.path[0];
  if (url.path.length === 0) return "";
  return "/" + url.path.join("/");
}

// The code points a URL is parsed from: its leading and trailing C0 controls and spaces gone,
// then every tab and newline.
function __urlInput(raw: string): i64[] {
  const all = __urlPoints(raw);
  let first: i64 = 0;
  let end = all.length as i64;
  while (first < end && all[first as usize] <= 32) first++;
  while (end > first && all[(end - 1) as usize] <= 32) end--;
  let input: i64[] = [];
  input.reserve(end - first);
  for (let i = first; i < end; i++) {
    const c = all[i as usize];
    if (c !== 9 && c !== 10 && c !== 13) input.push(c);
  }
  return input;
}

// The parser's path state: reads segments into url from p, the first begun in segment, up to the
// '?', '#' or end that ends the path, and gives where that is.
function __urlReadPath(input: Ref<i64[]>, start: i64, url: Mut<__urlRecord>, begun: u8[], special: boolean): i64 {
  let segment = begun;
  let p = start;
  while (true) {
    const c = __urlAt(input, p);
    // '/', or '\' in a special URL, which the parser takes for one.
    const slash = c === 47 || (special && c === 92);
    if (c === -1 || slash || c === 63 || c === 35) {
      let text = __urlText(segment);
      segment = [];
      if (__urlDoubleDot(text)) {
        __urlShorten(url);
        if (!slash) url.path.push("");
      } else if (__urlSingleDot(text) && !slash) url.path.push("");
      else if (!__urlSingleDot(text)) {
        if (url.scheme === "file" && url.path.length === 0 && __urlDrive(text, false)) text = text.slice(0, 1) + ":";
        url.path.push(text);
      }
      if (!slash) return p;
    } else __urlPut(segment, c, "path");
    p++;
  }
}

// The parser's host and port states over the code points between an authority's user info and
// its end: the URL's host and port set, or the message of the failure.
function __urlHostPort(points: Ref<i64[]>, url: Mut<__urlRecord>, special: boolean): string {
  const failure = "Invalid URL";
  const n = points.length as i64;
  // The host ends at the first ':' outside brackets.
  let end = n;
  let brackets = false;
  for (let i: i64 = 0; i < n && end === n; i++) {
    const c = points[i as usize];
    if (c === 58 && !brackets) end = i;
    else if (c === 91) brackets = true;
    else if (c === 93) brackets = false;
  }
  if (end === 0 && (end < n || special)) return failure;
  const host = __urlHostOf(points.slice(0, end), special);
  if (host.error.length > 0) return host.error;
  url.host = host.host;
  url.hasHost = true;
  if (end + 1 >= n) return "";
  let port: i64 = 0;
  for (let i = end + 1; i < n; i++) {
    const d = points[i as usize];
    if (!__urlDigit(d)) return failure;
    port = port * 10 + (d - 48);
    if (port > 65535) return failure;
  }
  url.port = port === __urlDefaultPort(url.scheme) ? -1 : port;
  return "";
}
`;

// The URL Standard's parser, URL and URLSearchParams.
const URL_LIB = String.raw`
function __urlSpecial(scheme: string): boolean {
  return scheme === "http" || scheme === "https" || scheme === "ws" || scheme === "wss" || scheme === "ftp" || scheme === "file";
}

// Code points as a string.
function __urlString(points: Ref<i64[]>): string {
  let out: u8[] = [];
  for (const c of points) __urlPut(out, c, "none");
  return __urlText(out);
}

// Whether the code points from i start with a Windows drive letter ending there or before a
// '/', '\', '?' or '#'.
function __urlStartsWithDrive(input: Ref<i64[]>, i: i64): boolean {
  const second = __urlAt(input, i + 1);
  if (!__urlAlpha(__urlAt(input, i)) || (second !== 58 && second !== 124)) return false;
  const third = __urlAt(input, i + 2);
  return third === -1 || third === 47 || third === 92 || third === 63 || third === 35;
}

// The URL Standard's basic URL parser, without a state override: a URL record, or the message
// of the TypeError for an input that isn't a URL.
function __urlParse(raw: string, base: __urlRecord | null): __urlRecord | string {
  const failure = "Invalid URL";
  const input = __urlInput(raw);
  const hasBase = base !== null;
  const b = base ?? __urlEmpty();
  let url = __urlEmpty();
  // The parser's states, as the URL Standard names them.
  const SCHEME_START = 0;
  const SCHEME = 1;
  const NO_SCHEME = 2;
  const FILE = 3;
  const SPECIAL_RELATIVE_OR_AUTHORITY = 4;
  const SPECIAL_AUTHORITY_SLASHES = 5;
  const PATH_OR_AUTHORITY = 6;
  const OPAQUE_PATH = 7;
  const FRAGMENT = 8;
  const RELATIVE = 9;
  const SPECIAL_AUTHORITY_IGNORE_SLASHES = 10;
  const AUTHORITY = 11;
  const PATH = 12;
  const RELATIVE_SLASH = 13;
  const QUERY = 14;
  const PATH_START = 17;
  const FILE_SLASH = 18;
  const FILE_HOST = 19;
  let state = SCHEME_START;
  // The code points read for a scheme, authority, host or port.
  let buffer: i64[] = [];
  // What the parser writes, as bytes, made strings at the end: the path segment being read, an
  // opaque path, the query, the fragment, and the user name and password.
  let segment: u8[] = [];
  let opaque: u8[] = [];
  let query: u8[] = [];
  let fragment: u8[] = [];
  let username: u8[] = [];
  let password: u8[] = [];
  let opaqueRead = false;
  let queryRead = false;
  let atSign = false;
  let passwordToken = false;
  let special = false;
  let p: i64 = 0;
  while (true) {
    const c = __urlAt(input, p);
    // '/', or '\' in a special URL, which the parser takes for one.
    const slash = c === 47 || (special && c === 92);
    if (state === SCHEME_START) {
      if (__urlAlpha(c)) {
        buffer.push(c | 32);
        state = SCHEME;
      } else {
        state = NO_SCHEME;
        p--;
      }
    } else if (state === SCHEME) {
      if (__urlAlpha(c) || __urlDigit(c) || c === 43 || c === 45 || c === 46) {
        buffer.push(__urlAlpha(c) ? c | 32 : c);
      } else if (c === 58) {
        url.scheme = __urlString(buffer);
        special = __urlSpecial(url.scheme);
        buffer = [];
        if (url.scheme === "file") state = FILE;
        else if (__urlSpecial(url.scheme) && hasBase && b.scheme === url.scheme) state = SPECIAL_RELATIVE_OR_AUTHORITY;
        else if (__urlSpecial(url.scheme)) state = SPECIAL_AUTHORITY_SLASHES;
        else if (__urlAt(input, p + 1) === 47) {
          state = PATH_OR_AUTHORITY;
          p++;
        } else {
          url.opaque = true;
          opaqueRead = true;
          state = OPAQUE_PATH;
        }
      } else {
        buffer = [];
        state = NO_SCHEME;
        p = -1;
      }
    } else if (state === NO_SCHEME) {
      if (!hasBase || (b.opaque && c !== 35)) return failure;
      if (b.opaque) {
        url.scheme = b.scheme.clone();
      special = __urlSpecial(url.scheme);
        special = __urlSpecial(url.scheme);
        url.path = b.path.clone();
        url.opaque = true;
        url.query = b.query.clone();
        url.hasQuery = b.hasQuery;
        url.hasFragment = true;
        state = FRAGMENT;
      } else {
        state = b.scheme === "file" ? FILE : RELATIVE;
        p--;
      }
    } else if (state === SPECIAL_RELATIVE_OR_AUTHORITY) {
      if (c === 47 && __urlAt(input, p + 1) === 47) {
        state = SPECIAL_AUTHORITY_IGNORE_SLASHES;
        p++;
      } else {
        state = RELATIVE;
        p--;
      }
    } else if (state === PATH_OR_AUTHORITY) {
      if (c === 47) state = AUTHORITY;
      else {
        state = PATH;
        p--;
      }
    } else if (state === RELATIVE) {
      url.scheme = b.scheme.clone();
      special = __urlSpecial(url.scheme);
      if (c === 47 || (__urlSpecial(url.scheme) && c === 92)) state = RELATIVE_SLASH;
      else {
        url.username = b.username.clone();
        url.password = b.password.clone();
        url.host = b.host.clone();
        url.hasHost = b.hasHost;
        url.port = b.port;
        url.path = b.path.clone();
        url.query = b.query.clone();
        url.hasQuery = b.hasQuery;
        if (c === 63) {
          queryRead = true;
          state = QUERY;
        } else if (c === 35) {
          url.hasFragment = true;
          state = FRAGMENT;
        } else if (c !== -1) {
          url.query = "";
          url.hasQuery = false;
          __urlShorten(url);
          state = PATH;
          p--;
        }
      }
    } else if (state === RELATIVE_SLASH) {
      if (special && (c === 47 || c === 92)) state = SPECIAL_AUTHORITY_IGNORE_SLASHES;
      else if (c === 47) state = AUTHORITY;
      else {
        url.username = b.username.clone();
        url.password = b.password.clone();
        url.host = b.host.clone();
        url.hasHost = b.hasHost;
        url.port = b.port;
        state = PATH;
        p--;
      }
    } else if (state === SPECIAL_AUTHORITY_SLASHES) {
      state = SPECIAL_AUTHORITY_IGNORE_SLASHES;
      if (c === 47 && __urlAt(input, p + 1) === 47) p++;
      else p--;
    } else if (state === SPECIAL_AUTHORITY_IGNORE_SLASHES) {
      if (c !== 47 && c !== 92) {
        state = AUTHORITY;
        p--;
      }
    } else if (state === AUTHORITY) {
      if (c === 64) {
        // A second '@' was part of the user info.
        if (atSign) {
          if (passwordToken) __urlPut(password, 64, "userinfo");
          else __urlPut(username, 64, "userinfo");
        }
        atSign = true;
        for (const point of buffer) {
          if (point === 58 && !passwordToken) {
            passwordToken = true;
            continue;
          }
          if (passwordToken) __urlPut(password, point, "userinfo");
          else __urlPut(username, point, "userinfo");
        }
        buffer = [];
      } else if (c === -1 || slash || c === 63 || c === 35) {
        if (atSign && buffer.length === 0) return failure;
        const error = __urlHostPort(buffer, url, special);
        if (error.length > 0) return error;
        buffer = [];
        state = PATH_START;
        p--;
      } else buffer.push(c);
    } else if (state === FILE) {
      url.scheme = "file";
      special = __urlSpecial(url.scheme);
      url.host = "";
      url.hasHost = true;
      if (c === 47 || c === 92) state = FILE_SLASH;
      else if (hasBase && b.scheme === "file") {
        url.host = b.host.clone();
        url.hasHost = b.hasHost;
        url.path = b.path.clone();
        url.query = b.query.clone();
        url.hasQuery = b.hasQuery;
        if (c === 63) {
          queryRead = true;
          state = QUERY;
        } else if (c === 35) {
          url.hasFragment = true;
          state = FRAGMENT;
        } else if (c !== -1) {
          url.query = "";
          url.hasQuery = false;
          if (!__urlStartsWithDrive(input, p)) __urlShorten(url);
          else url.path = [];
          state = PATH;
          p--;
        }
      } else {
        state = PATH;
        p--;
      }
    } else if (state === FILE_SLASH) {
      if (c === 47 || c === 92) state = FILE_HOST;
      else {
        if (hasBase && b.scheme === "file") {
          url.host = b.host.clone();
          url.hasHost = b.hasHost;
          if (!__urlStartsWithDrive(input, p) && b.path.length > 0 && __urlDrive(b.path[0], true)) url.path.push(b.path[0].clone());
        }
        state = PATH;
        p--;
      }
    } else if (state === FILE_HOST) {
      if (c === -1 || c === 47 || c === 92 || c === 63 || c === 35) {
        p--;
        // A drive letter isn't a host: it starts the path.
        if (buffer.length === 2 && __urlAlpha(buffer[0]) && (buffer[1] === 58 || buffer[1] === 124)) {
          for (const d of buffer) segment.push(d as u8);
          buffer = [];
          state = PATH;
        } else if (buffer.length === 0) {
          url.host = "";
          url.hasHost = true;
          state = PATH_START;
        } else {
          const host = __urlHostOf(buffer, true);
          if (host.error.length > 0) return host.error;
          url.host = host.host === "localhost" ? "" : host.host;
          url.hasHost = true;
          buffer = [];
          state = PATH_START;
        }
      } else buffer.push(c);
    } else if (state === PATH_START) {
      if (special) {
        state = PATH;
        if (c !== 47 && c !== 92) p--;
      } else if (c === 63) {
        queryRead = true;
        state = QUERY;
      } else if (c === 35) {
        url.hasFragment = true;
        state = FRAGMENT;
      } else if (c !== -1) {
        state = PATH;
        if (c !== 47) p--;
      }
    } else if (state === PATH) {
      p = __urlReadPath(input, p, url, segment, special);
      segment = [];
      const end = __urlAt(input, p);
      if (end === 63) {
        queryRead = true;
        state = QUERY;
      } else if (end === 35) {
        url.hasFragment = true;
        state = FRAGMENT;
      }
    } else if (state === OPAQUE_PATH) {
      if (c === 63) {
        queryRead = true;
        state = QUERY;
      } else if (c === 35) {
        url.hasFragment = true;
        state = FRAGMENT;
      } else if (c === 32) {
        const next = __urlAt(input, p + 1);
        if (next === 63 || next === 35) __urlPutByte(opaque, 32, true);
        else opaque.push(32);
      } else if (c !== -1) __urlPut(opaque, c, "c0");
    } else if (state === QUERY) {
      if (c === 35) {
        url.hasFragment = true;
        state = FRAGMENT;
      } else if (c !== -1) __urlPut(query, c, special ? "specialQuery" : "query");
    } else if (state === FRAGMENT) {
      if (c !== -1) __urlPut(fragment, c, "fragment");
    }
    if (p >= (input.length as i64)) break;
    p++;
  }
  if (opaqueRead) url.path = [__urlText(opaque)];
  if (queryRead) {
    url.query = __urlText(query);
    url.hasQuery = true;
  }
  url.fragment = __urlText(fragment);
  if (atSign) {
    url.username = __urlText(username);
    url.password = __urlText(password);
  }
  return url;
}

// A request's path: its URL's pathname, with a relative URL read against http://localhost. One
// that isn't a URL has the empty path, which no route matches; the server answers such a
// request 400 before making it.
function __urlRequestPath(url: string): string {
  const base = __urlParse("http://localhost/", null);
  const parsed = __urlParse(url, typeof base === "string" ? null : base);
  return typeof parsed === "string" ? "" : __urlPathText(parsed);
}

// Where an http: URL points, for fetch: its record, or why it can't be fetched.
function __urlFetchTarget(url: string): __urlRecord | string {
  const parsed = __urlParse(url, null);
  if (typeof parsed === "string") return parsed.startsWith("Invalid URL: ") ? parsed.slice(13) : "it isn't a valid URL";
  if (parsed.scheme === "https") return "https: needs TLS, which isn't supported yet";
  if (parsed.scheme !== "http") return "only http: URLs are supported";
  if (parsed.username.length > 0 || parsed.password.length > 0) return "a URL can't hold a user name or password";
  if (parsed.port === 0) return "the port isn't a number from 1 to 65535";
  return parsed;
}

// A URL written out, with the query its params hold now.
function __urlHref(url: Ref<__urlRecord>, query: string | null, fragment: boolean): string {
  let out = url.scheme + ":";
  if (url.hasHost) {
    out = out + "//";
    if (url.username.length > 0 || url.password.length > 0) {
      out = out + url.username;
      if (url.password.length > 0) out = out + ":" + url.password;
      out = out + "@";
    }
    out = out + url.host;
    if (url.port >= 0) out = out + ":" + String(url.port);
  } else if (!url.opaque && url.path.length > 1 && url.path[0].length === 0) out = out + "/.";
  out = out + __urlPathText(url);
  if (query !== null) out = out + "?" + query;
  if (fragment && url.hasFragment) out = out + "#" + url.fragment;
  return out;
}

function __urlOrigin(url: Ref<__urlRecord>): string {
  const s = url.scheme;
  if (s === "blob") {
    const inner = __urlParse(__urlPathText(url), null);
    if (typeof inner === "string" || (inner.scheme !== "http" && inner.scheme !== "https")) return "null";
    return __urlOrigin(inner);
  }
  if (s !== "http" && s !== "https" && s !== "ws" && s !== "wss" && s !== "ftp") return "null";
  return s + "://" + url.host + (url.port >= 0 ? ":" + String(url.port) : "");
}

// A WHATWG URL. Its parts are read through getters. Its query is the one parsed until its
// searchParams change, and then theirs, so a change made there shows in search and href.
class URL {
  private url: __urlRecord;
  readonly searchParams: URLSearchParams;

  constructor(url: string, base?: string | URL) throws TypeError {
    let from: __urlRecord | null = null;
    if (base !== null) {
      if (typeof base === "string") {
        const parsed = __urlParse(base, null);
        if (typeof parsed === "string") throw new TypeError(parsed);
        from = parsed;
      } else from = base.record();
    }
    const parsed = __urlParse(url, from);
    if (typeof parsed === "string") throw new TypeError(parsed);
    const params = new URLSearchParams(parsed.query.clone());
    this.url = parsed;
    this.searchParams = params;
  }

  static parse(url: string, base?: string | URL): URL | null {
    try {
      return new URL(url, base);
    } catch (e) {
      return null;
    }
  }

  static canParse(url: string, base?: string | URL): boolean {
    return URL.parse(url, base) !== null;
  }

  // The query now: none once changed params are empty.
  private query(): string | null {
    if (this.searchParams.__urlChanged.get()) {
      const text = this.searchParams.toString();
      return text.length === 0 ? null : text;
    }
    return this.url.hasQuery ? this.url.query.clone() : null;
  }

  // The record with the query it has now.
  private record(): __urlRecord {
    let r = this.url.clone();
    const q = this.query();
    r.hasQuery = q !== null;
    r.query = q ?? "";
    return r;
  }

  get href(): string { return __urlHref(this.url, this.query(), true); }
  get origin(): string { return __urlOrigin(this.url); }
  get protocol(): string { return this.url.scheme + ":"; }
  get username(): string { return this.url.username; }
  get password(): string { return this.url.password; }
  get host(): string { return this.url.port >= 0 ? this.url.host + ":" + String(this.url.port) : this.url.host; }
  get hostname(): string { return this.url.host; }
  get port(): string { return this.url.port >= 0 ? String(this.url.port) : ""; }
  get pathname(): string { return __urlPathText(this.url); }
  get search(): string {
    const q = this.query();
    if (q === null || q.length === 0) return "";
    return "?" + q;
  }
  get hash(): string { return this.url.fragment.length > 0 ? "#" + this.url.fragment : ""; }
  toString(): string { return this.href; }
  toJSON(): string { return this.href; }

  // A copy with params of its own. The standard makes a URL's href parse back to the same URL.
  clone(): URL {
    return URL.parse(this.href)!;
  }
}

// Appends text as application/x-www-form-urlencoded writes a name or value.
function __urlFormPut(out: Mut<u8[]>, text: string) {
  for (const c of __urlPoints(text)) {
    if (c === 32) out.push(43);
    else __urlPut(out, c, __urlAlpha(c) || __urlDigit(c) || c === 42 || c === 45 || c === 46 || c === 95 ? "none" : "form");
  }
}

// A form-urlencoded name or value read back: '+' as a space, then percent escapes as UTF-8.
function __urlFormDecode(text: string): string {
  const bytes = new TextEncoder().encode(text.replaceAll("+", " "));
  return __urlText(__urlPercentDecode(bytes));
}

// Whether a sorts before b by UTF-16 code units, as JavaScript compares strings.
function __urlBefore(a: string, b: string): boolean {
  const n = a.length < b.length ? a.length : b.length;
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x !== y) return x < y;
  }
  return a.length < b.length;
}

// A URL's query as name and value pairs, or form data on its own. The pairs sit in a Cell, so
// a URL's searchParams change in place while the URL keeps them read-only.
class URLSearchParams {
  // Each name, then its value.
  private pairs: Cell<string[]> = new Cell<string[]>([]);
  // Whether the pairs have changed, which makes them the query of the URL they belong to.
  __urlChanged: Cell<boolean> = new Cell<boolean>(false);

  constructor(init?: string | [string, string][]) {
    let pairs: string[] = [];
    if (init !== null) {
      if (typeof init === "string") {
        const text = init.startsWith("?") ? init.slice(1) : init;
        for (const pair of text.split("&")) {
          if (pair.length === 0) continue;
          const eq = pair.indexOf("=");
          pairs.push(__urlFormDecode(eq >= 0 ? pair.slice(0, eq) : pair));
          pairs.push(eq >= 0 ? __urlFormDecode(pair.slice(eq + 1)) : "");
        }
      } else {
        for (const [name, value] of init) {
          pairs.push(name);
          pairs.push(value);
        }
      }
    }
    this.pairs.set(pairs);
  }

  get size(): i64 {
    const pairs = this.pairs.replace([]);
    const n = (pairs.length / 2) as i64;
    this.pairs.set(pairs);
    return n;
  }

  append(name: string, value: string) {
    let pairs = this.pairs.replace([]);
    pairs.push(name);
    pairs.push(value);
    this.changed(pairs);
  }

  // Drops every pair with the name, or only those also holding the value given.
  delete(name: string, value?: string) {
    const pairs = this.pairs.replace([]);
    let kept: string[] = [];
    for (let i: usize = 0; i + 1 < pairs.length; i += 2) {
      if (pairs[i] === name && (value === null || pairs[i + 1] === value)) continue;
      kept.push(pairs[i]);
      kept.push(pairs[i + 1]);
    }
    this.changed(kept);
  }

  get(name: string): string | null {
    const pairs = this.pairs.replace([]);
    let found: string | null = null;
    for (let i: usize = 0; i + 1 < pairs.length; i += 2) {
      if (pairs[i] === name) {
        found = pairs[i + 1];
        break;
      }
    }
    this.pairs.set(pairs);
    return found;
  }

  getAll(name: string): string[] {
    const pairs = this.pairs.replace([]);
    let out: string[] = [];
    for (let i: usize = 0; i + 1 < pairs.length; i += 2) {
      if (pairs[i] === name) out.push(pairs[i + 1]);
    }
    this.pairs.set(pairs);
    return out;
  }

  has(name: string, value?: string): boolean {
    const pairs = this.pairs.replace([]);
    let found = false;
    for (let i: usize = 0; i + 1 < pairs.length; i += 2) {
      if (pairs[i] === name && (value === null || pairs[i + 1] === value)) found = true;
    }
    this.pairs.set(pairs);
    return found;
  }

  // The first pair with the name takes the value, and the rest with it go.
  set(name: string, value: string) {
    const pairs = this.pairs.replace([]);
    let kept: string[] = [];
    let found = false;
    for (let i: usize = 0; i + 1 < pairs.length; i += 2) {
      if (pairs[i] !== name) {
        kept.push(pairs[i]);
        kept.push(pairs[i + 1]);
      } else if (!found) {
        found = true;
        kept.push(name.clone());
        kept.push(value.clone());
      }
    }
    if (!found) {
      kept.push(name);
      kept.push(value);
    }
    this.changed(kept);
  }

  // Orders the pairs by name, by UTF-16 code units, keeping pairs of one name in their order.
  sort() {
    const pairs = this.pairs.replace([]);
    const count = (pairs.length / 2) as i64;
    let order: i64[] = [];
    for (let i: i64 = 0; i < count; i++) {
      let j = i;
      while (j > 0 && __urlBefore(pairs[(2 * i) as usize], pairs[(2 * order[(j - 1) as usize]) as usize])) j--;
      order.splice(j, 0, i);
    }
    let sorted: string[] = [];
    for (const i of order) {
      sorted.push(pairs[(2 * i) as usize]);
      sorted.push(pairs[(2 * i + 1) as usize]);
    }
    this.changed(sorted);
  }

  toString(): string {
    const pairs = this.pairs.replace([]);
    let out: u8[] = [];
    for (let i: usize = 0; i + 1 < pairs.length; i += 2) {
      if (i > 0) out.push(38);
      __urlFormPut(out, pairs[i]);
      out.push(61);
      __urlFormPut(out, pairs[i + 1]);
    }
    this.pairs.set(pairs);
    return __urlText(out);
  }

  forEach(callback: (value: string, name: string) => void) {
    const pairs = this.pairs.replace([]);
    for (let i: usize = 0; i + 1 < pairs.length; i += 2) callback(pairs[i + 1], pairs[i]);
    this.pairs.set(pairs);
  }

  entries(): [string, string][] {
    const pairs = this.pairs.replace([]);
    let out: [string, string][] = [];
    for (let i: usize = 0; i + 1 < pairs.length; i += 2) out.push([pairs[i], pairs[i + 1]]);
    this.pairs.set(pairs);
    return out;
  }

  keys(): string[] { return this.every(0); }
  values(): string[] { return this.every(1); }

  // Every name, or every value.
  private every(at: usize): string[] {
    const pairs = this.pairs.replace([]);
    let out: string[] = [];
    for (let i: usize = at; i < pairs.length; i += 2) out.push(pairs[i]);
    this.pairs.set(pairs);
    return out;
  }

  // A copy whose pairs change apart from these.
  clone(): URLSearchParams {
    const pairs = this.pairs.replace([]);
    const copy = new URLSearchParams();
    copy.pairs.set(pairs.clone());
    copy.__urlChanged.set(this.__urlChanged.get());
    this.pairs.set(pairs);
    return copy;
  }

  private changed(pairs: string[]) {
    this.pairs.set(pairs);
    this.__urlChanged.set(true);
  }
}
`;

const BYTE_METHODS = ["toBase64", "toHex"];
const BYTE_STATICS = ["fromBase64", "fromHex"];
const URL_NAMES = ["URL", "URLSearchParams"];
// std's names a program may declare its own of, which std's own code then reaches under another.
const HIDDEN_NAMES = [...URL_NAMES, "TypeError", "Date"];
// std's top-level names for its own code: a program can't use them as std means them, so no
// suggestion offers them.
export const STD_INTERNAL = new Set(["Http1", "HttpHead", "serveConnection"]);
const HTTP_NAMES = ["fetch", "serve", "Router", "Request", "Response", "Headers", "CookieMap", "CookieInit", "RequestCookies", "ServeOptions", "ServeInfo", "ServeHandler", "RequestInit", "ResponseInit"];

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

// The encoders and decoders on bytes, in a program that calls one of them or btoa or atob.
const BYTES = `
// bytes.toBase64(options) and bytes.toHex(), as TC39's Uint8Array methods. Text is built as bytes
// and decoded once, since appending to a string copies it.
function __arrayToBase64(bytes: Ref<u8[]>, options?: { alphabet?: "base64" | "base64url"; omitPadding?: boolean }): string {
  return __arrayBase64Text(bytes, options?.alphabet === "base64url", options?.omitPadding !== true);
}
function __arrayBase64Text(bytes: Ref<u8[]>, url: boolean, pad: boolean): string {
  const table = new TextEncoder().encode(url ? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_" : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/");
  const n = bytes.length;
  let out: u8[] = [];
  out.reserve(((n + 2) / 3 * 4) as i64);
  let i: usize = 0;
  while (i + 3 <= n) {
    const v = ((bytes[i] as i64) << 16) | ((bytes[i + 1] as i64) << 8) | (bytes[i + 2] as i64);
    out.push(table[(v >> 18) as usize]);
    out.push(table[((v >> 12) & 63) as usize]);
    out.push(table[((v >> 6) & 63) as usize]);
    out.push(table[(v & 63) as usize]);
    i += 3;
  }
  const left = n - i;
  if (left > 0) {
    const v = ((bytes[i] as i64) << 16) | (left === 2 ? (bytes[i + 1] as i64) << 8 : 0);
    out.push(table[(v >> 18) as usize]);
    out.push(table[((v >> 12) & 63) as usize]);
    if (left === 2) out.push(table[((v >> 6) & 63) as usize]);
    if (pad) {
      if (left === 1) out.push(61);
      out.push(61);
    }
  }
  return new TextDecoder().decode(out);
}
function __arrayToHex(bytes: Ref<u8[]>): string {
  const digits = new TextEncoder().encode("0123456789abcdef");
  let out: u8[] = [];
  out.reserve((bytes.length * 2) as i64);
  for (const b of bytes) {
    out.push(digits[(b >> 4) as usize]);
    out.push(digits[(b & 15) as usize]);
  }
  return new TextDecoder().decode(out);
}
// A base64 character's value, or -1 for one outside the alphabet.
function __arrayBase64Value(c: i64, url: boolean): i64 {
  if (c >= 65 && c <= 90) return c - 65;
  if (c >= 97 && c <= 122) return c - 71;
  if (c >= 48 && c <= 57) return c + 4;
  if (c === (url ? 45 : 43)) return 62;
  if (c === (url ? 95 : 47)) return 63;
  return -1;
}
// ASCII whitespace, as the HTML spec and TC39 skip it.
function __arrayBase64Space(c: i64): boolean {
  return c === 32 || c === 9 || c === 10 || c === 12 || c === 13;
}
// A chunk of 2, 3 or 4 characters' values as its bytes. A short chunk's bits past its last byte are
// dropped, or refused when they must be zero.
function __arrayBase64Chunk(out: Mut<u8[]>, v: i64, count: i64, strict: boolean): void throws TypeError {
  const bits = v << ((4 - count) * 6);
  if (strict && (bits & (count === 2 ? 0xFFFF : count === 3 ? 0xFF : 0)) !== 0) throw new TypeError("base64 input has bits set past its last byte; fix its last character, or decode with lastChunkHandling: \\"loose\\"");
  out.push((bits >> 16) as u8);
  if (count > 2) out.push(((bits >> 8) & 255) as u8);
  if (count > 3) out.push((bits & 255) as u8);
}
// u8.fromBase64(s, options), TC39's FromBase64 with no length limit.
function __arrayFromBase64(s: string, options?: { alphabet?: "base64" | "base64url"; lastChunkHandling?: "loose" | "strict" | "stop-before-partial" }): u8[] throws TypeError {
  const url = options?.alphabet === "base64url";
  const handling = options?.lastChunkHandling ?? "loose";
  const text = new TextEncoder().encode(s);
  const n = text.length as i64;
  let out: u8[] = [];
  out.reserve(n / 4 * 3);
  let v: i64 = 0;
  let count: i64 = 0;
  let i: i64 = 0;
  while (true) {
    while (i < n && __arrayBase64Space(text[i as usize] as i64)) i++;
    if (i === n) {
      if (count === 0 || handling === "stop-before-partial") return out;
      if (handling === "strict") throw new TypeError("base64 input ends in a chunk without its padding; pad it with '=', or decode with lastChunkHandling: \\"loose\\"");
      if (count === 1) throw new TypeError("base64 input ends in a lone character, which holds no whole byte; check it isn't cut short");
      __arrayBase64Chunk(out, v, count, false);
      return out;
    }
    const c = text[i as usize] as i64;
    i++;
    if (c === 61) {
      if (count < 2) throw new TypeError("base64 padding '=' goes after the second or third character of a chunk of four");
      while (i < n && __arrayBase64Space(text[i as usize] as i64)) i++;
      if (count === 2) {
        if (i === n) {
          if (handling === "stop-before-partial") return out;
          throw new TypeError("base64 padding after two characters is '=='; add the second '='");
        }
        if (text[i as usize] === 61) {
          i++;
          while (i < n && __arrayBase64Space(text[i as usize] as i64)) i++;
        }
      }
      if (i < n) throw new TypeError("base64 input goes on after its padding; '=' only ends it");
      __arrayBase64Chunk(out, v, count, handling === "strict");
      return out;
    }
    const d = __arrayBase64Value(c, url);
    if (d < 0) throw new TypeError(url ? "base64url input holds a character outside A-Z, a-z, 0-9, '-' and '_'; decode standard base64 without alphabet: \\"base64url\\"" : "base64 input holds a character outside A-Z, a-z, 0-9, '+' and '/'; decode base64url with alphabet: \\"base64url\\"");
    v = (v << 6) | d;
    count++;
    if (count === 4) {
      __arrayBase64Chunk(out, v, 4, false);
      v = 0;
      count = 0;
    }
  }
}
function __arrayHexValue(c: i64): i64 {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 97 && c <= 102) return c - 87;
  if (c >= 65 && c <= 70) return c - 55;
  return -1;
}
// u8.fromHex(s): two digits a byte, in either case.
function __arrayFromHex(s: string): u8[] throws TypeError {
  const text = new TextEncoder().encode(s);
  if (text.length % 2 !== 0) throw new TypeError("hex input has an odd number of digits; each byte is two");
  let out: u8[] = [];
  out.reserve((text.length / 2) as i64);
  let i: usize = 0;
  while (i < text.length) {
    const high = __arrayHexValue(text[i] as i64);
    const low = __arrayHexValue(text[i + 1] as i64);
    if (high < 0 || low < 0) throw new TypeError("hex input holds a character outside 0-9, a-f and A-F");
    out.push((high * 16 + low) as u8);
    i += 2;
  }
  return out;
}
`;
// btoa and atob, each in a program that names it and doesn't declare it, so a program's own
// polyfill of one keeps its name and std's other stays.
const BTOA = `
// btoa and atob, as the HTML spec has them: base64 of a string's characters as Latin-1 bytes. The
// UTF-8 the string holds is read back as code points up to U+00FF.
function btoa(data: string): string throws TypeError {
  const text = new TextEncoder().encode(data);
  let bytes: u8[] = [];
  bytes.reserve(text.length as i64);
  let i: usize = 0;
  while (i < text.length) {
    const b = text[i];
    if (b < 0x80) {
      bytes.push(b);
      i += 1;
    } else if (b === 0xC2 || b === 0xC3) {
      bytes.push(((b & 3) << 6) | (text[i + 1] & 63));
      i += 2;
    } else {
      throw new TypeError("btoa takes characters up to U+00FF; for other text, encode it as UTF-8 first, as in 'new TextEncoder().encode(s).toBase64()'");
    }
  }
  return __arrayBase64Text(bytes, false, true);
}
`;
const DATE = String.raw`
// A point in time as JavaScript's Date holds one, in milliseconds since 1970-01-01T00:00:00Z,
// read in UTC. A time JavaScript would make an Invalid Date of panics where it is made, as Fish
// panics where JavaScript throws a RangeError, so every Date can be written out.
class Date {
  #time: i64;

  constructor(ms?: i64) {
    const time = ms ?? Date.now();
    assert(time >= -8640000000000000 && time <= 8640000000000000, "a Date holds a time within 8640000000000000 milliseconds of 1970-01-01, so " + String(time) + " can't be one");
    this.#time = time;
  }

  getTime(): i64 { return this.#time; }
  valueOf(): i64 { return this.#time; }
  equals(other: Ref<Date>): boolean { return this.#time === other.getTime(); }

  getUTCFullYear(): i64 { return __dateCivil(this.#time)[0]; }
  getUTCMonth(): i64 { return __dateCivil(this.#time)[1]; }
  getUTCDate(): i64 { return __dateCivil(this.#time)[2]; }
  getUTCDay(): i64 { return __dateCivil(this.#time)[3]; }
  getUTCHours(): i64 { return __dateCivil(this.#time)[4]; }
  getUTCMinutes(): i64 { return __dateCivil(this.#time)[5]; }
  getUTCSeconds(): i64 { return __dateCivil(this.#time)[6]; }
  getUTCMilliseconds(): i64 { return __dateCivil(this.#time)[7]; }

  // Years outside 0000 to 9999 take a sign and six digits, as ECMAScript's expanded years do.
  toISOString(): string {
    const c = __dateCivil(this.#time);
    const y = c[0];
    const year = y >= 0 && y <= 9999 ? __datePad(y, 4) : (y < 0 ? "-" : "+") + __datePad(y < 0 ? -y : y, 6);
    return year + "-" + __datePad(c[1] + 1, 2) + "-" + __datePad(c[2], 2) + "T" + __datePad(c[4], 2) + ":" + __datePad(c[5], 2) + ":" + __datePad(c[6], 2) + "." + __datePad(c[7], 3) + "Z";
  }

  toJSON(): string { return this.toISOString(); }

  // The IMF-fixdate HTTP writes, with a year past four digits or before zero written as
  // ECMAScript's toUTCString writes it.
  toUTCString(): string {
    const c = __dateCivil(this.#time);
    const y = c[0];
    return "Sun,Mon,Tue,Wed,Thu,Fri,Sat".split(",")[c[3] as usize] + ", " + __datePad(c[2], 2) + " " + "Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec".split(",")[c[1] as usize] + " " + (y < 0 ? "-" : "") + __datePad(y < 0 ? -y : y, 4) + " " + __datePad(c[4], 2) + ":" + __datePad(c[5], 2) + ":" + __datePad(c[6], 2) + " GMT";
  }
}

function __datePad(n: i64, width: usize): string {
  return String(n).padStart(width, "0");
}

// A time's year, month from 0, day of the month, weekday from Sunday, hours, minutes, seconds
// and milliseconds in UTC.
function __dateCivil(ms: i64): [i64, i64, i64, i64, i64, i64, i64, i64] {
  let days = ms / 86400000;
  let rest = ms % 86400000;
  if (rest < 0) {
    days -= 1;
    rest += 86400000;
  }
  // Howard Hinnant's days_from_civil, run backwards: the date of a day count from 1970-01-01.
  const z = days + 719468;
  const era = (z >= 0 ? z : z - 146096) / 146097;
  const doe = z - era * 146097;
  const yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  const doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const mp = (5 * doy + 2) / 153;
  const day = doy - (153 * mp + 2) / 5 + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  // 1970-01-01 was a Thursday.
  const weekday = ((days % 7) + 11) % 7;
  const seconds = rest / 1000;
  return [year, month - 1, day, weekday, seconds / 3600, seconds / 60 % 60, seconds % 60, rest % 1000];
}
`;
const ATOB = `
// The HTML spec's forgiving-base64 decode: whitespace is dropped, then up to two '=' that end a
// whole chunk, and what is left must be a whole number of bytes in the standard alphabet.
function atob(data: string): string throws TypeError {
  const text = new TextEncoder().encode(data);
  let chars: u8[] = [];
  chars.reserve(text.length as i64);
  for (const c of text) {
    if (!__arrayBase64Space(c as i64)) chars.push(c);
  }
  let n = chars.length;
  if (n % 4 === 0 && n > 0 && chars[n - 1] === 61) n -= chars[n - 2] === 61 ? 2 : 1;
  const bad = "atob takes base64 in A-Z, a-z, 0-9, '+' and '/', with '=' only as padding; decode base64url with u8.fromBase64(s, { alphabet: \\"base64url\\" })";
  if (n % 4 === 1) throw new TypeError(bad);
  let bytes: u8[] = [];
  bytes.reserve((n / 4 * 3) as i64);
  let v: i64 = 0;
  let count: i64 = 0;
  for (let i: usize = 0; i < n; i++) {
    const d = __arrayBase64Value(chars[i] as i64, false);
    if (d < 0) throw new TypeError(bad);
    v = (v << 6) | d;
    count++;
    if (count === 4) {
      __arrayBase64Chunk(bytes, v, 4, false);
      v = 0;
      count = 0;
    }
  }
  if (count > 0) __arrayBase64Chunk(bytes, v, count, false);
  // Each byte as the code point of the same number, in UTF-8.
  let out: u8[] = [];
  out.reserve((bytes.length * 2) as i64);
  for (const b of bytes) {
    if (b < 0x80) out.push(b);
    else {
      out.push(0xC0 | (b >> 6));
      out.push(0x80 | (b & 63));
    }
  }
  return new TextDecoder().decode(out);
}
`;

// The std modules a program reaches by a Node specifier, as `node:os` or `os`, or by naming one
// as a global, each Fish source loaded like a file of the program.
export const STD_MODULES: Record<string, string> = {
  // Node's assert and assert.ok, whose calls the checker gives the global assert's meaning, so
  // they panic where they are made.
  assert: String.raw`
export function ok(_value: boolean, _message?: string): void {}
`,
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
  // Web Crypto's random functions, and Node's randomBytes, from the OS's secure random source. A
  // u8[] stands in for Uint8Array and Buffer.
  crypto: String.raw`
declare function fsh_rt_random_fill(at: MutPtr<u8>, count: usize): void;

// Fills the array in place and gives it back. Web Crypto fills at most 65536 bytes a call.
export function getRandomValues(array: Mut<u8[]>): Mut<u8[]> {
  const n = array.length;
  assert(n <= 65536, "QuotaExceededError: getRandomValues fills at most 65536 bytes a call, not " + String(n) + "; fill a larger array in pieces");
  if (n > 0) unsafe { fsh_rt_random_fill(mutPtrOf(array[0]), n) };
  return array;
}

export function randomBytes(size: i64): u8[] {
  assert(size >= 0, "randomBytes takes a size of 0 or more, not " + String(size));
  let out: u8[] = new Array(size).fill(0 as u8);
  if (size > 0) unsafe { fsh_rt_random_fill(mutPtrOf(out[0]), size as usize) };
  return out;
}

// A version 4 UUID, RFC 9562's: 122 random bits, then the version and variant in lowercase hex.
export function randomUUID(): string {
  let b = randomBytes(16);
  b[6] = (b[6] & 0x0F) | 0x40;
  b[8] = (b[8] & 0x3F) | 0x80;
  const digits = new TextEncoder().encode("0123456789abcdef");
  let out: u8[] = [];
  out.reserve(36);
  for (let i: usize = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out.push(45);
    out.push(digits[(b[i] >> 4) as usize]);
    out.push(digits[(b[i] & 15) as usize]);
  }
  return new TextDecoder().decode(out);
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
  child_process: String.raw`
declare function fsh_rt_signal_name(n: i64): Ptr<u8>;
declare function write(fd: i32, data: Ptr<u8>, length: usize): isize;

// A "utf8" encoding is read from the call's literal, which then gives text; an options value held
// elsewhere can't ask for text, its encoding only null.
export type SpawnSyncOptions = { cwd?: string; input?: string | u8[]; encoding?: "buffer" | null };

export class SpawnSyncReturns<T> {
  pid: i64;
  status: i64 | null;
  signal: string | null;
  stdout: T;
  stderr: T;
  error: IoError | null;
  constructor(pid: i64, status: i64 | null, signal: string | null, stdout: T, stderr: T, error: IoError | null) {
    this.pid = pid;
    this.status = status;
    this.signal = signal;
    this.stdout = stdout;
    this.stderr = stderr;
    this.error = error;
  }
}

export function spawnSync(command: string, args: string[] = [], options: SpawnSyncOptions = {}): SpawnSyncReturns<u8[]> {
  const input = options.input ?? "";
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  try {
    const [pid, status, signo, stdout, stderr] = processSpawn(command, args, options.cwd ?? "", bytes);
    const name = signo === 0 ? null : unsafe { fsh_rt_signal_name(signo).isNull() ? "SIG" + signo : fromCString(fsh_rt_signal_name(signo)) };
    return new SpawnSyncReturns<u8[]>(pid, status < 0 ? null : status, name, stdout, stderr, null);
  } catch (e) {
    return new SpawnSyncReturns<u8[]>(0, null, null, [], [], e);
  }
}

// A command that ran but exited with a code other than 0, or was ended by a signal.
export class ExecError extends Error {
  status: i64 | null;
  signal: string | null;
  stdout: u8[];
  stderr: u8[];
  constructor(message: string, status: i64 | null, signal: string | null, stdout: u8[], stderr: u8[]) {
    super(message);
    this.status = status;
    this.signal = signal;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

// What the exec calls give: the child's stdout, after its stderr has gone on to this process's,
// as Node's do; or the error, Node's message naming the command as it was given.
function executed(r: SpawnSyncReturns<u8[]>, command: string): u8[] throws IoError | ExecError {
  if (r.stderr.length > 0) unsafe { write(2, ptrOf(r.stderr[0]), r.stderr.length as usize) };
  const failed = r.error;
  if (failed !== null) throw failed;
  if (r.status === 0) return r.stdout;
  const text = new TextDecoder();
  const message = r.stderr.length > 0 ? "Command failed: " + command + "\n" + text.decode(r.stderr) : "Command failed: " + command;
  throw new ExecError(message, r.status, r.signal, r.stdout, r.stderr);
}

export function execFileSync(file: string, args: string[] = [], options: SpawnSyncOptions = {}): u8[] throws IoError | ExecError {
  const named = [file, ...args].join(" ");
  return executed(spawnSync(file, args, options), named);
}

export function execFileSyncText(file: string, args: string[] = [], options: SpawnSyncOptions = {}): string throws IoError | ExecError {
  return new TextDecoder().decode(execFileSync(file, args, options));
}

export function execSync(command: string, options: SpawnSyncOptions = {}): u8[] throws IoError | ExecError {
  return executed(spawnSync("/bin/sh", ["-c", command], options), command);
}

export function execSyncText(command: string, options: SpawnSyncOptions = {}): string throws IoError | ExecError {
  return new TextDecoder().decode(execSync(command, options));
}

export function spawnSyncText(command: string, args: string[] = [], options: SpawnSyncOptions = {}): SpawnSyncReturns<string> {
  const r = spawnSync(command, args, options);
  const text = new TextDecoder();
  return new SpawnSyncReturns<string>(r.pid, r.status, r.signal, text.decode(r.stdout), text.decode(r.stderr), r.error);
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

// Aborted by the first SIGINT or SIGTERM; a second exits at once with 130 or 143.
export function shutdown(): AbortSignal {
  return shutdownSignal();
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
  process: { argv: "value", env: "table", shutdown: "value" },
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

// What awaiting a JS promise that rejects throws: the JS error's message, and what JS threw. It
// is in programs that use a package or name it, as holding a JsValue links the engine in.
const JS_ERROR = String.raw`
class JsError extends Error {
  value: JsValue;
  constructor(message: string, value: JsValue) {
    super(message);
    this.name = "JsError";
    this.value = value;
  }
}
`;

export const STD_SOURCE = PRELUDE + HTTP + FETCH + SERVED + URL_CORE + URL_LIB + JSON_VALUE + JSON_NAME + AST + AST_HELPERS + JS_ERROR + BYTES + BTOA + ATOB + DATE;
export const STD_FILE = "<fish std>";
// std's text as a program's last source, for rendering an error or a panic inside it.
export const STD: Source = { base: STD_BASE, src: STD_SOURCE, file: STD_FILE };

// A hash of the std source, the compiler's own sources and Bun's version, which decides the
// serialization format, so no other parser's tree is ever loaded. Null when no compiler source
// can be read, as inside a single-file executable, since the hash couldn't tell parsers apart.
export function stdKey(source: string, dir: string): string | null {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".ts")).sort();
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  const hash = createHash("sha256").update(Bun.version).update("\0").update(source);
  for (const f of files) hash.update("\0").update(f).update("\0").update(readFileSync(join(dir, f)));
  return hash.digest("hex").slice(0, 16);
}

// std's parsed tree, serialized: kept in the session's memory, else read from the cache, else
// parsed and written there, the session counting the parse. A cache that can't be read or written
// only costs the parse, and without a key the cache isn't touched at all.
function stdBytes({ std }: Session): Uint8Array {
  if (std.key === undefined) std.key = stdKey(STD_SOURCE, import.meta.dir);
  const path = std.key === null ? null : join(cacheDir(), "std", `ast-${std.key}.bin`);
  if (std.tree !== undefined && std.tree.path === path) return std.tree.bytes;
  let bytes: Uint8Array | undefined;
  if (path !== null) {
    try {
      bytes = readFileSync(path);
      // A tree from before nodes had ids, or anything else, is made again.
      const cached = deserialize(bytes);
      if (!Array.isArray(cached) || typeof cached[0]?.id !== "number") bytes = undefined;
    } catch {
      bytes = undefined;
    }
  }
  if (bytes === undefined) {
    std.parses++;
    // Ids are each compilation's own, so the cached tree holds zeros, and each copy is numbered
    // as it is loaded.
    bytes = new Uint8Array(serialize(renumber(parse(STD_SOURCE, { last: 0 }), () => 0)));
    if (path !== null) {
      try {
        const temp = partial(path);
        writeFileSync(temp, bytes);
        renameSync(temp, path);
      } catch {}
    }
  }
  std.tree = { path, bytes };
  return bytes;
}

// The std statements a program is checked with, their spans moved past its own.
export function stdFor({ session, ids }: Compilation, written: Stmt[]): Stmt[] {
  // Each call takes its own copy, since the passes below change the tree.
  const all: Stmt[] = renumber(deserialize(stdBytes(session)), () => nextId(ids));
  shiftSpans(all, STD_BASE);
  // The array iterators' generators and the promise cells take names no program can write, so
  // none hides them.
  hideHelpers(all);
  const at = (s: Stmt) => s.start - STD_BASE;
  let from = 0;
  // The statements of std's next section, in the order STD_SOURCE joins them.
  const next = (text: string) => {
    const start = from;
    from += text.length;
    return all.filter((s) => at(s) >= start && at(s) < from);
  };
  const prelude = next(PRELUDE);
  const http = next(HTTP);
  const fetching = next(FETCH);
  const served = next(SERVED);
  const core = next(URL_CORE);
  const url = next(URL_LIB);
  const json = next(JSON_VALUE);
  const jsonName = next(JSON_NAME);
  const ast = next(AST + AST_HELPERS);
  const js = next(JS_ERROR);
  const bytes = next(BYTES);
  const btoa = next(BTOA);
  const atob = next(ATOB);
  const dates = next(DATE);
  renameValue([...json, ...jsonName]);
  const astNames = ast.flatMap(declaredNames);
  const parts = [[json, ["Json", "JSON"]], [jsonName, ["Json"]], [ast, [...astNames, "quote", "quoteType"]], [js, ["JsError"]], [btoa, ["btoa"]], [atob, ["atob"]]] as const;
  const packages = written.some(fromPackage);
  // A program's own URL, URLSearchParams or TypeError keeps its name, and std's takes one no
  // program can write.
  const declared = new Set(written.flatMap(declaredNames));
  const own = new Set(HIDDEN_NAMES.filter((n) => declared.has(n)));
  if (own.size > 0) hideNames([...prelude, ...http, ...fetching, ...core, ...url, ...bytes, ...btoa, ...atob, ...dates], own);
  // fetch, URL and a Request the program builds read any URL, so they need the whole parser. The
  // server's requests, from a Host it checked and a target, need only its host and path rules.
  const httpUsed = uses(written, http, HTTP_NAMES);
  const fetchUsed = httpUsed && uses(written, fetching, ["fetch"]);
  const urlWanted = fetchUsed || uses(written, [], URL_NAMES) || (httpUsed && mentions(written, (n) => n.kind === "ident" && n.name === "Request"));
  const urls = [...(httpUsed && !urlWanted ? served : []), ...(httpUsed || urlWanted ? core : []), ...(urlWanted ? url : [])];
  const linked = parts.flatMap(([part, names]) => (uses(written, part, [...names]) || (part === js && packages) ? part : []));
  // The checker turns 'bytes.toBase64()' and 'u8.fromHex(s)' into calls of these helpers, and
  // btoa and atob call them too.
  const encoding = linked.some((s) => btoa.includes(s) || atob.includes(s)) || mentions(written, encodes);
  const dated = httpUsed || uses(written, dates, ["Date"]);
  return [...prelude, ...(dated ? dates : []), ...(httpUsed ? http : []), ...(fetchUsed ? fetching : []), ...urls, ...linked, ...(encoding ? bytes : [])];
}

// A call of a byte encoder or decoder: 'x.toBase64', 'x.toHex', 'u8.fromBase64' or 'u8.fromHex'.
function encodes(n: Record<string, unknown>): boolean {
  if (n.kind !== "member" || typeof n.name !== "string") return false;
  const object = n.object as { kind?: string; name?: string };
  return BYTE_METHODS.includes(n.name) || (BYTE_STATICS.includes(n.name) && object.kind === "ident" && object.name === "u8");
}

// The prelude's helpers, declared and called as `__arrayFilled`, become `array filled`, which
// no program can write.
function hideHelpers(nodes: unknown) {
  if (Array.isArray(nodes)) return nodes.forEach(hideHelpers);
  if (typeof nodes !== "object" || nodes === null) return;
  const node = nodes as Record<string, unknown>;
  const hidden = node.kind === "function" || node.kind === "ident" || node.kind === "typeAlias" || node.kind === "ref" || node.kind === "field" || node.kind === "member";
  if (hidden && typeof node.name === "string" && /^__(array|iter|promise|timer|timeout|router|url|date)/.test(node.name)) {
    node.name = node.name.slice(2).replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`);
  }
  Object.values(node).forEach(hideHelpers);
}

// Renames std's classes a program declares its own of to names no program can write.
function hideNames(nodes: unknown, names: Set<string>) {
  if (Array.isArray(nodes)) return nodes.forEach((n) => hideNames(n, names));
  if (typeof nodes !== "object" || nodes === null) return;
  const node = nodes as Record<string, unknown>;
  if ((node.kind === "class" || node.kind === "ident" || node.kind === "ref") && typeof node.name === "string" && names.has(node.name)) node.name = `std ${node.name}`;
  Object.values(node).forEach((n) => hideNames(n, names));
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
// A declaration a package made, as its imports are linked into the program.
function fromPackage(s: Stmt): boolean {
  return s.kind === "export" || s.kind === "declare" ? fromPackage(s.body) : "js" in s && s.js !== undefined;
}

function uses(written: Stmt[], library: Stmt[], wanted: string[]): boolean {
  const declared = new Set(written.flatMap(declaredNames));
  if (library.some((s) => declaredNames(s).some((n) => declared.has(n)))) return false;
  // A name the program declares is its own, not the library's.
  return mentions(written, (n) => (n.kind === "ident" || n.kind === "ref") && typeof n.name === "string" && wanted.includes(n.name) && !declared.has(n.name));
}

// The top-level names a statement binds: a declaration's, each name its `let` or `const`
// patterns bind, and an import's, through `export` and `declare`.
function declaredNames(s: Stmt): string[] {
  switch (s.kind) {
    case "export":
    case "declare":
      return declaredNames(s.body);
    case "exportDefault":
      return s.declaration === undefined ? [] : declaredNames(s.declaration);
    case "let":
      return s.declarations.flatMap((d) => boundNames(d.target));
    case "import":
      return [...(s.default === undefined ? [] : [s.default]), ...(s.namespace === undefined ? [] : [s.namespace]), ...(s.named ?? []).map((n) => n.alias ?? n.name)];
    default:
      return "name" in s && typeof s.name === "string" ? [s.name] : [];
  }
}

// The names a binding pattern binds; a default's value binds none.
function boundNames(p: Pattern | undefined): string[] {
  if (p === undefined) return [];
  switch (p.kind) {
    case "ident":
      return [p.name];
    case "object":
      return [...p.props.flatMap((prop) => boundNames(prop.value)), ...boundNames(p.rest)];
    case "array":
      return [...p.elements.flatMap(boundNames), ...boundNames(p.rest)];
    case "default":
      return boundNames(p.target);
    default:
      return [];
  }
}

// Whether a node in a tree is one the test picks.
function mentions(v: unknown, test: (node: Record<string, unknown>) => boolean): boolean {
  if (Array.isArray(v)) return v.some((n) => mentions(n, test));
  if (typeof v !== "object" || v === null) return false;
  const node = v as Record<string, unknown>;
  return test(node) || Object.values(node).some((n) => mentions(n, test));
}
