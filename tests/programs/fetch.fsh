// The HTTP client: fetch against servers the same program runs on 127.0.0.1 or localhost.
// case: fetch_abort
// expect: before: This operation was aborted
// expect: before: no connection was made
// expect: headers: This operation was aborted
// expect: headers: the server saw the connection end
// expect: body: This operation was aborted
// expect: body: the server saw the connection end
// An abort before fetch starts, while it waits for the response's headers, and while it reads
// the body: each throws AbortError, and a connection it opened is closed.
async function hold(listener: TcpListener, reply: string): Promise<string> {
  try {
    const conn = await listener.accept();
    let got: u8[] = [];
    while (!new TextDecoder().decode(got).includes("\r\n\r\n")) {
      const more = await conn.read(4096);
      if (more.length === 0) break;
      for (const b of more) got.push(b);
    }
    if (reply.length > 0) await conn.write(new TextEncoder().encode(reply));
    const rest = await conn.read(16, AbortSignal.timeout(5000));
    return rest.length === 0 ? "the server saw the connection end" : "the server got more";
  } catch (e) {
    if (e instanceof AbortError) return "the connection stayed open";
    return "the server failed: " + e.message;
  }
}

async function attempt(what: string, url: string, signal: AbortSignal): Promise<void> {
  try {
    const res = await fetch(url, { signal: signal });
    console.log(what + ": got", res.status);
  } catch (e) {
    if (e instanceof AbortError) console.log(what + ": " + e.message);
    else console.log(what + ": io " + e.message);
  }
}

async function main(): Promise<void> throws IoError | AbortError {
  const idle = await TcpListener.bind("127.0.0.1", 0);
  const ctl = new AbortController();
  ctl.abort();
  await attempt("before", "http://127.0.0.1:" + String(idle.port) + "/", ctl.signal);
  try {
    const conn = await idle.accept(AbortSignal.timeout(50));
    console.log("before: a connection was made");
  } catch (e) {
    if (e instanceof AbortError) console.log("before: no connection was made");
  }
  const cases: [string, string][] = [["headers", ""], ["body", "HTTP/1.1 200 OK\r\ncontent-length: 100\r\n\r\npart of it"]];
  for (const [what, reply] of cases) {
    const listener = await TcpListener.bind("127.0.0.1", 0);
    const url = "http://localhost:" + String(listener.port) + "/";
    const server = spawn(hold(listener, reply));
    await attempt(what, url, AbortSignal.timeout(200));
    const saw = await server;
    console.log(what + ": " + saw);
  }
}
// case: fetch_binary
// expect: server got 3|0 255 195
// expect: 200 3|0 255 195|content-type: true|text 3
// expect: big 20000 true
// A u8[] body goes out from fetch as it is, and res.bytes() gives a binary download as it came,
// one past the size the server joins to its head included.
async function main(): Promise<void> throws IoError | AbortError {
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => {
    if (req.path === "/big") {
      let big: u8[] = [];
      for (let i = 0; i < 20000; i++) big.push((i % 256) as u8);
      return new Response(big);
    }
    const got = await req.bytes();
    console.log("server got " + String(got.length) + "|" + String(got[0]) + " " + String(got[1]) + " " + String(got[2]));
    return new Response(got);
  }));
  while (found.port.load() === 0) await sleep(1);
  const sent: u8[] = [0, 255, 195];
  const res = await fetch("http://127.0.0.1:" + String(found.port.load()) + "/upload", { method: "POST", body: sent });
  const back = await res.bytes();
  const text = await res.text();
  console.log(String(res.status) + " " + String(back.length) + "|" + String(back[0]) + " " + String(back[1]) + " " + String(back[2]) + "|content-type: " + String(res.headers.get("content-type") === null) + "|text " + String(text.length));
  const download = await fetch("http://127.0.0.1:" + String(found.port.load()) + "/big");
  const all = await download.bytes();
  let same = true;
  for (let i: usize = 0; i < all.length; i++) if (all[i] !== ((i % 256) as u8)) same = false;
  console.log("big " + String(all.length) + " " + String(same));
}
// case: fetch_errors
// expect: refused: can't connect: Connection refused ECONNREFUSED
// expect: malformed: the response's status line 'garbage' isn't HTTP/1.x
// expect: bad length: the response's Content-Length isn't a number
// expect: bad chunk: the response's chunk size 'zz' isn't a hexadecimal number
// expect: cut short: the connection closed before the response's body ended
// expect: long chunk line: the response's chunk size line is over 1 KiB
// expect: too big: the response's status line and headers are over 64 KiB
// expect: header: can't fetch 'http://127.0.0.1:PORT/': header 'x-a' holds a line break or isn't a header name
// expect: ftp: can't fetch 'ftp://example.test/': only http: URLs are supported
// expect: https: can't fetch 'https://example.test/': https: needs TLS, which isn't supported yet
// expect: no host: can't fetch 'http://': it isn't a valid URL
// expect: user: can't fetch 'http://me@example.test/': a URL can't hold a user name or password
// expect: port: can't fetch 'http://example.test:0/': the port isn't a number from 1 to 65535
// expect: big port: can't fetch 'http://example.test:99999/': it isn't a valid URL
// expect: relative: can't fetch '/x': it isn't a valid URL
// expect: idn: can't fetch 'http://café.test/': international domain names aren't supported yet
// Each raw reply answers one connection; anything that goes wrong comes back as an IoError.
async function answer(listener: TcpListener, replies: string[]): Promise<void> {
  for (const reply of replies) {
    try {
      const conn = await listener.accept();
      let got: u8[] = [];
      while (!new TextDecoder().decode(got).includes("\r\n\r\n")) {
        const more = await conn.read(4096);
        if (more.length === 0) break;
        for (const b of more) got.push(b);
      }
      await conn.write(new TextEncoder().encode(reply));
    } catch (e) {
      continue;
    }
  }
}

async function attempt(what: string, url: string, init: RequestInit, port: i64): Promise<void> {
  try {
    const res = await fetch(url, init);
    console.log(what + ": got", res.status);
  } catch (e) {
    if (e instanceof IoError) console.log(what + ": " + e.message.replace(String(port), "PORT"));
    else console.log(what + ": aborted");
  }
}

async function main(): Promise<void> throws IoError {
  let free: i64 = 0;
  {
    const closed = await TcpListener.bind("127.0.0.1", 0);
    free = closed.port;
  }
  try {
    const res = await fetch("http://127.0.0.1:" + String(free) + "/");
  } catch (e) {
    if (e instanceof IoError) console.log("refused: " + e.message, e.code);
  }
  const listener = await TcpListener.bind("127.0.0.1", 0);
  const port = listener.port;
  const url = "http://127.0.0.1:" + String(port) + "/";
  spawn(answer(listener, [
    "garbage\r\n\r\n",
    "HTTP/1.1 200 OK\r\ncontent-length: ten\r\n\r\n",
    "HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\nzz\r\nhi\r\n0\r\n\r\n",
    "HTTP/1.1 200 OK\r\ncontent-length: 10\r\n\r\nhi",
    "HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n1" + "0".repeat(100000),
    "HTTP/1.1 200 OK\r\nx-big: " + "a".repeat(70000) + "\r\n\r\n",
  ]));
  for (const what of ["malformed", "bad length", "bad chunk", "cut short", "long chunk line", "too big"]) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      console.log(what + ": got", res.status, text);
    } catch (e) {
      if (e instanceof IoError) console.log(what + ": " + e.message);
    }
  }
  let h = new Headers();
  h.set("x-a", "1\r\nx-b: 2");
  await attempt("header", url, { headers: h }, port);
  await attempt("ftp", "ftp://example.test/", {}, port);
  await attempt("https", "https://example.test/", {}, port);
  await attempt("no host", "http://", {}, port);
  await attempt("user", "http://me@example.test/", {}, port);
  await attempt("port", "http://example.test:0/", {}, port);
  await attempt("big port", "http://example.test:99999/", {}, port);
  await attempt("relative", "/x", {}, port);
  await attempt("idn", "http://café.test/", {}, port);
}
// case: fetch_framing
// expect: length|hello
// expect: chunked|hello, world
// expect: to the end|until it closes
// expect: head|200 0
// expect: no content|204 0
// expect: early hints|200 after
// Bodies framed by Content-Length, by chunks, and by the connection closing, and none for HEAD,
// 204, or an interim 1xx before the response.
async function answer(listener: TcpListener, replies: string[]): Promise<void> {
  for (const reply of replies) {
    try {
      const conn = await listener.accept();
      let got: u8[] = [];
      while (!new TextDecoder().decode(got).includes("\r\n\r\n")) {
        const more = await conn.read(4096);
        if (more.length === 0) break;
        for (const b of more) got.push(b);
      }
      await conn.write(new TextEncoder().encode(reply));
    } catch (e) {
      continue;
    }
  }
}

async function main(): Promise<void> throws IoError | AbortError {
  const listener = await TcpListener.bind("127.0.0.1", 0);
  const url = "http://localhost:" + String(listener.port) + "/";
  spawn(answer(listener, [
    "HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello and more",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5;ext=1\r\nhello\r\n7\r\n, world\r\n0\r\nx-trailer: 1\r\n\r\n",
    "HTTP/1.0 200 OK\r\n\r\nuntil it closes",
    "HTTP/1.1 200 OK\r\nContent-Length: 50\r\n\r\n",
    "HTTP/1.1 204 No Content\r\n\r\n",
    "HTTP/1.1 103 Early Hints\r\nlink: </a.css>\r\n\r\nHTTP/1.1 200 OK\r\ncontent-length: 5\r\n\r\nafter",
  ]));
  for (const what of ["length", "chunked", "to the end"]) {
    const res = await fetch(url);
    const text = await res.text();
    console.log(what + "|" + text);
  }
  const head = await fetch(url, { method: "HEAD" });
  console.log("head|" + String(head.status), head.body.length);
  const none = await fetch(url);
  console.log("no content|" + String(none.status), none.body.length);
  const hinted = await fetch(url);
  const text = await hinted.text();
  console.log("early hints|" + String(hinted.status), text);
}
// case: fetch_get
// expect: 200 OK true application/json 3 http://localhost:PORT/data?x=1
// expect: from a request: PUT /echo q
// expect: built: 0 ""
// A GET against serve: status, headers, text, json, ok and the URL without its fragment, and a
// Request given in place of a URL, with init overriding it.
async function main(): Promise<void> throws IoError | AbortError | JsonError {
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => {
    if (req.path === "/data") return Response.json({ n: 3 });
    const body = await req.text();
    return new Response(req.method + " " + req.path + " " + body);
  }));
  while (found.port.load() === 0) await sleep(1);
  const port = found.port.load();
  const res = await fetch("http://localhost:" + String(port) + "/data?x=1#part");
  const data = await res.json<{ n: i64 }>();
  console.log(res.status, res.statusText, res.ok, res.headers.get("content-type"), data.n, res.url.replace(String(port), "PORT"));
  const req = new Request("http://127.0.0.1:" + String(port) + "/echo", { method: "POST", body: "q" });
  const put = await fetch(req, { method: "put" });
  const text = await put.text();
  console.log("from a request: " + text);
  const built = new Response("x");
  console.log("built:", built.status - 200, JSON.stringify(built.url));
}
// case: fetch_url
// expect: GET /caf%C3%A9 http://127.0.0.1:PORT/caf%C3%A9?q=%C3%BC
// expect: http://127.0.0.1:PORT/caf%C3%A9?q=%C3%BC
// expect: GET /a%20b http://127.0.0.1:PORT/a%20b
// A URL given to fetch, and a string parsed as one, sent with its path percent-encoded.
async function main(): Promise<void> throws IoError | AbortError | TypeError {
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => {
    return new Response(req.method + " " + req.path + " " + req.url);
  }));
  while (found.port.load() === 0) await sleep(1);
  const port = String(found.port.load());
  const res = await fetch(new URL("/caf\u00e9?q=\u00fc", "http://127.0.0.1:" + port));
  const text = await res.text();
  console.log(text.replaceAll(port, "PORT"));
  console.log(res.url.replace(port, "PORT"));
  const spaced = await fetch("http://127.0.0.1:" + port + "/a b#frag");
  const said = await spaced.text();
  console.log(said.replaceAll(port, "PORT"));
}
// case: fetch_ipv6
// expect: listening on ::1
// expect: [::1]:PORT http://[::1]:PORT/a [::1]:PORT
// expect: no host: http://[::1]:PORT/b
// expect: dual stack: 127.0.0.1:PORT
// A server on ::1 fetched by a bracketed URL, the brackets kept in the Host header and the URL;
// a request with no Host header named by the server's own address; and a server on :: reached
// over IPv4.
async function listen(hostname: string, quiet: boolean): Promise<i64> {
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: hostname, onListen: (info: ServeInfo) => {
    if (!quiet) console.log("listening on " + info.hostname);
    seen.port.store(info.port);
  } }, async (req: Request) => {
    const host = req.headers.get("host") ?? "none";
    return new Response(host + " " + req.url);
  }));
  while (found.port.load() === 0) await sleep(1);
  return found.port.load();
}

async function main(): Promise<void> throws IoError | AbortError | TypeError {
  const port = await listen("::1", false);
  const p = String(port);
  const url = new URL("http://[::1]:" + p + "/a");
  const host = url.host;
  const res = await fetch(url);
  const text = await res.text();
  console.log(text.replaceAll(p, "PORT"), host.replace(p, "PORT"));
  const conn = await TcpStream.connect("::1", port);
  await conn.write(new TextEncoder().encode("GET /b HTTP/1.0\r\n\r\n"));
  let got: u8[] = [];
  while (true) {
    const more = await conn.read(4096);
    if (more.length === 0) break;
    for (const b of more) got.push(b);
  }
  const reply = new TextDecoder().decode(got);
  console.log("no host: " + reply.slice(reply.indexOf("none ") + 5).replaceAll(p, "PORT"));
  const dual = await listen("::", true);
  const both = String(dual);
  const four = await fetch("http://127.0.0.1:" + both + "/");
  const said = await four.text();
  console.log("dual stack: " + said.slice(0, said.indexOf(" ")).replaceAll(both, "PORT"));
}
// case: fetch_post
// expect: POST /submit
// expect: host: 127.0.0.1:PORT
// expect: content-type: application/json
// expect: x-trace: abc
// expect: accept: */*
// expect: user-agent: fish
// expect: content-length: 13
// expect: connection: close
// expect: body: {"name":"ok"}
// expect: empty post content-length: 0
// expect: own accept: text/plain
// A POST's body and headers as the server sees them: the caller's, then Host, Accept,
// User-Agent, Content-Length and Connection as fetch sets them.
async function main(): Promise<void> throws IoError | AbortError {
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => {
    let text = req.method + " " + req.path + "\n";
    req.headers.forEach((value: string, name: string) => { text = text + name + ": " + value + "\n"; });
    const body = await req.text();
    return new Response(text + "body: " + body);
  }));
  while (found.port.load() === 0) await sleep(1);
  const port = found.port.load();
  const url = "http://127.0.0.1:" + String(port) + "/submit";
  let h = new Headers();
  h.set("Content-Type", "application/json");
  h.set("X-Trace", "abc");
  h.set("Connection", "keep-alive");
  h.set("Content-Length", "999");
  const res = await fetch(url, { method: "POST", headers: h, body: JSON.stringify({ name: "ok" }) });
  const text = await res.text();
  console.log(text.replace(String(port), "PORT"));
  const empty = await fetch(url, { method: "POST" });
  const got = await empty.text();
  for (const line of got.split("\n")) if (line.startsWith("content-length")) console.log("empty post " + line);
  let own = new Headers();
  own.set("accept", "text/plain");
  const mine = await fetch(url, { headers: own });
  const back = await mine.text();
  for (const line of back.split("\n")) if (line.startsWith("accept")) console.log("own " + line);
}
// case: fetch_status
// expect: 404 false Not Found
// expect: 302 false /elsewhere
// A 404 resolves as a response, and a redirect is returned with its Location, not followed.
async function main(): Promise<void> throws IoError | AbortError {
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => {
    if (req.path === "/moved") {
      let h = new Headers();
      h.set("location", "/elsewhere");
      return new Response(null, { status: 302, headers: h });
    }
    return new Response("Not Found", { status: 404 });
  }));
  while (found.port.load() === 0) await sleep(1);
  const base = "http://127.0.0.1:" + String(found.port.load());
  const missing = await fetch(base + "/nothing");
  const text = await missing.text();
  console.log(missing.status, missing.ok, text);
  const moved = await fetch(base + "/moved");
  console.log(moved.status, moved.ok, moved.headers.get("location"));
}
// case: fetch_unix
// expect: 200 POST http://example.test/data q
// expect: missing: ENOENT
// fetch with unix sends the request over a socket path, the URL's host in the Host header.
import { mkdtempSync, rmSync } from "node:fs";

async function main(): Promise<void> throws IoError | AbortError {
  const dir = mkdtempSync("/tmp/fish-unix-");
  const path = dir + "/f.sock";
  const state = shared({ ready: new Atomic(0) });
  const seen = state.clone();
  const ctl = new AbortController();
  const server = spawn(serve({ unix: path, signal: ctl.signal, onListen: (info: ServeInfo) => { seen.ready.store(1); } }, async (req: Request) => {
    const body = await req.text();
    return new Response(req.method + " " + req.url + " " + body);
  }));
  while (state.ready.load() === 0) await sleep(1);
  const res = await fetch("http://example.test/data", { method: "POST", body: "q", unix: path });
  const text = await res.text();
  console.log(res.status, text);
  try {
    const none = await fetch("http://example.test/", { unix: dir + "/none.sock" });
  } catch (e) {
    if (e instanceof IoError) console.log("missing: " + e.code);
    else console.log("aborted");
  }
  ctl.abort();
  await server;
  rmSync(dir, { recursive: true });
}
