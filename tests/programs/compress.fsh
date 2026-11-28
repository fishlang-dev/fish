// case: compress_negotiate
// expect: br
// expect: gzip
// expect: gzip
// expect: deflate
// expect: br
// expect: -
// expect: -
// expect: gzip
// expect: br
// expect: -
// The highest q wins, a tie goes to br, then gzip, then deflate, and * stands for the rest.
import { negotiate } from "std:compress";
function main() {
  const values = ["gzip, deflate, br", "gzip", "br;q=0.5, gzip", "deflate", "*", "", "identity", "br;q=0, *;q=0.3, deflate;q=0.2", "GZIP;Q=0.9, BR", "br;q=0, gzip;q=0, deflate;q=0"];
  for (const v of values) {
    const coding = negotiate(v);
    console.log(coding === "" ? "-" : coding);
  }
}
// case: compress_gzip
// expect: 200 gzip Accept-Encoding true
// expect: 3000 true
// A whole body over the threshold is gzipped, and unzips to what the route gave.
import { compress } from "std:compress";
import { gunzipSync, ZlibError } from "std:zlib";
function header(name: string, value: string): Headers {
  let h = new Headers();
  h.set(name, value);
  return h;
}
async function main(): Promise<void> throws ZlibError {
  let app = new Router();
  app.use(compress());
  app.get("/", async (req) => new Response("abc".repeat(1000)));
  const res = await app.handle(new Request("http://h/", { headers: header("accept-encoding", "gzip") }));
  const bytes = await res.bytes();
  console.log(res.status, res.headers.get("content-encoding"), res.headers.get("vary"), bytes.length < 3000);
  const text = new TextDecoder().decode(gunzipSync(bytes));
  console.log(text.length, text === "abc".repeat(1000));
}
// case: compress_deflate
// expect: deflate 2002 true
// deflate is zlib's format, as HTTP names it.
import { compress } from "std:compress";
import { inflateSync, ZlibError } from "std:zlib";
function header(name: string, value: string): Headers {
  let h = new Headers();
  h.set(name, value);
  return h;
}
async function main(): Promise<void> throws ZlibError {
  let app = new Router();
  app.use(compress());
  app.get("/", async (req) => Response.json({ items: "x".repeat(1990) }));
  const res = await app.handle(new Request("http://h/", { headers: header("accept-encoding", "deflate") }));
  const bytes = await res.bytes();
  const text = new TextDecoder().decode(inflateSync(bytes));
  console.log(res.headers.get("content-encoding"), text.length, text.startsWith("{\"items\":\"xxx"));
}
// case: compress_brotli
// expect: br Accept-Encoding true
// br is chosen over gzip when both are accepted, and compresses a repetitive body.
import { compress } from "std:compress";
function header(name: string, value: string): Headers {
  let h = new Headers();
  h.set(name, value);
  return h;
}
async function main() {
  let app = new Router();
  app.use(compress());
  app.get("/", async (req) => new Response("hello brotli ".repeat(500)));
  const res = await app.handle(new Request("http://h/", { headers: header("accept-encoding", "gzip, deflate, br") }));
  const bytes = await res.bytes();
  console.log(res.headers.get("content-encoding"), res.headers.get("vary"), bytes.length < 200);
}
// case: compress_skipped
// expect: small - Accept-Encoding 5
// expect: png - - 2000
// expect: encoded gzip Accept-Encoding 2000
// expect: no-transform - - 2000
// expect: head - Accept-Encoding 2000
// expect: none - Accept-Encoding 2000
// expect: unaccepted - Accept-Encoding 2000
// expect: tiny-threshold gzip Accept-Encoding 22
// What is left as it is: a body under 1 KiB, a type that comes compressed, a body already
// coded, one marked no-transform, a HEAD request and a request accepting no coding. Vary is
// still added to every response that could have been coded.
import { compress } from "std:compress";
function header(name: string, value: string): Headers {
  let h = new Headers();
  h.set(name, value);
  return h;
}
function both(name: string, value: string): Headers {
  let h = header(name, value);
  h.set("vary", "Accept-Encoding");
  return h;
}
async function show(app: Ref<Router>, name: string, method: string, accept: string): Promise<void> {
  const res = await app.handle(new Request("http://h/" + name, { method: method, headers: header("accept-encoding", accept) }));
  const bytes = await res.bytes();
  console.log(name, res.headers.get("content-encoding") ?? "-", res.headers.get("vary") ?? "-", bytes.length);
}
async function main() {
  const big = "z".repeat(2000);
  let app = new Router();
  app.use(compress());
  app.get("/small", async (req) => new Response("small"));
  app.get("/png", async (req) => new Response(big.clone(), { headers: header("content-type", "image/png") }));
  app.get("/encoded", async (req) => new Response(big.clone(), { headers: both("content-encoding", "gzip") }));
  app.get("/no-transform", async (req) => new Response(big.clone(), { headers: header("cache-control", "public, no-transform") }));
  app.get("/head", async (req) => new Response(big.clone()));
  app.get("/none", async (req) => new Response(big.clone()));
  app.get("/unaccepted", async (req) => new Response(big.clone()));
  await show(app, "small", "GET", "gzip");
  await show(app, "png", "GET", "gzip");
  await show(app, "encoded", "GET", "gzip");
  await show(app, "no-transform", "GET", "gzip");
  await show(app, "head", "HEAD", "gzip");
  await show(app, "none", "GET", "");
  await show(app, "unaccepted", "GET", "identity, br;q=0");
  let tiny = new Router();
  tiny.use(compress({ threshold: 0 }));
  tiny.get("/tiny-threshold", async (req) => new Response("hi"));
  await show(tiny, "tiny-threshold", "GET", "gzip");
}
// case: compress_vary_joined
// expect: Origin, Accept-Encoding
// A Vary the route set gains Accept-Encoding after its own names.
import { compress } from "std:compress";
function header(name: string, value: string): Headers {
  let h = new Headers();
  h.set(name, value);
  return h;
}
async function main() {
  let app = new Router();
  app.use(compress());
  app.get("/", async (req) => new Response("v".repeat(2000), { headers: header("vary", "Origin") }));
  const res = await app.handle(new Request("http://h/", { headers: header("accept-encoding", "gzip") }));
  console.log(res.headers.get("vary"));
}
// case: compress_streamed
// expect: gzip 4
// expect: event 0|event 1|event 2|
// A streamed body is coded chunk by chunk, each flushed so it can be sent as it comes, and the
// last ends the stream.
import { compress } from "std:compress";
import { gunzipSync, ZlibError } from "std:zlib";
function header(name: string, value: string): Headers {
  let h = new Headers();
  h.set(name, value);
  return h;
}
async function* events(): AsyncGenerator<string> {
  for (let i = 0; i < 3; i++) yield "event " + String(i) + "|";
}
async function main(): Promise<void> throws ZlibError {
  let app = new Router();
  app.use(compress());
  app.get("/", async (req) => new Response(events()));
  const res = await app.handle(new Request("http://h/", { headers: header("accept-encoding", "gzip") }));
  const body = res.body;
  let all: u8[] = [];
  let chunks = 0;
  if (body !== null) {
    for await (const chunk of body) {
      chunks += 1;
      for (const b of chunk) all.push(b);
    }
  }
  console.log(res.headers.get("content-encoding"), chunks);
  console.log(new TextDecoder().decode(gunzipSync(all)));
}
// case: compress_streamed_brotli
// expect: br 4
// A small streamed body is coded too, its size being unknown, and with brotli.
import { compress } from "std:compress";
function header(name: string, value: string): Headers {
  let h = new Headers();
  h.set(name, value);
  return h;
}
async function* pieces(): AsyncGenerator<u8[]> {
  yield new TextEncoder().encode("a");
  yield new TextEncoder().encode("b");
  yield new TextEncoder().encode("c");
}
async function main() {
  let app = new Router();
  app.use(compress());
  app.get("/", async (req) => new Response(ReadableStream.from(pieces()), { headers: header("content-type", "application/octet-stream") }));
  const res = await app.handle(new Request("http://h/", { headers: header("accept-encoding", "br") }));
  const body = res.body;
  let chunks = 0;
  if (body !== null) for await (const chunk of body) if (chunk.length > 0) chunks += 1;
  console.log(res.headers.get("content-encoding"), chunks);
}
