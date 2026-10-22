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
    this.path = pathOf(url);
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

// A URL's path: after the scheme and host, up to its query or fragment.
function pathOf(url: string): string {
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
