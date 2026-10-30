// case: http_classes
// expect: text/html a=1, b=2 false none
// expect: false
// expect: content-type=text/html;
// expect: POST http://localhost:8080/users/7?full=1#top /users/7 hello false
// expect: GET /x false
// expect: 201 true text/plain;charset=UTF-8 true
// expect: hi
// expect: 404 false false 0
// expect: 200
// The Fetch API's Headers, Request and Response, from the std HTTP library.
async function main(): Promise<void> {
  let h = new Headers();
  h.set("Content-Type", "text/html");
  h.append("Set-Cookie", "a=1");
  h.append("set-cookie", "b=2");
  console.log(h.get("content-type"), h.get("SET-COOKIE"), h.has("x"), h.get("x") ?? "none");
  h.delete("Set-Cookie");
  console.log(h.has("set-cookie"));
  let names = "";
  h.forEach((value: string, name: string) => { names = names + name + "=" + value + ";"; });
  console.log(names);
  const req = new Request("http://localhost:8080/users/7?full=1#top", { method: "post", body: "hello" });
  const body = await req.text();
  console.log(req.method, req.url, req.path, body, req.signal.aborted);
  const plain = new Request("/x");
  console.log(plain.method, plain.path, plain.headers.has("a"));
  const res = new Response("hi", { status: 201 });
  console.log(res.status, res.ok, res.headers.get("content-type"), res.statusText === "");
  const text = await res.text();
  console.log(text);
  const empty = new Response(null, { status: 404 });
  console.log(empty.status, empty.ok, empty.headers.has("content-type"), empty.body.length);
  const bare = new Response();
  console.log(bare.status);
}
// case: http_host
// expect: path from host|HTTP/1.1 400 Bad Request
// expect: no host|HTTP/1.1 400 Bad Request
// expect: two hosts|HTTP/1.1 400 Bad Request
// expect: 1.0 without host|/public|http://127.0.0.1:PORT/public
// expect: plain host|/public|http://example.test:8080/public
// The Host header names the server only: it can't change the path, and HTTP/1.1 needs one.
async function ask(port: i64, raw: string): Promise<string> throws IoError {
  const conn = await TcpStream.connect("127.0.0.1", port);
  await conn.write(new TextEncoder().encode(raw));
  let all: u8[] = [];
  while (true) {
    const got = await conn.read(4096);
    if (got.length === 0) break;
    for (const b of got) all.push(b);
  }
  return new TextDecoder().decode(all);
}

async function main(): Promise<void> throws IoError {
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info) => { seen.port.store(info.port); } }, async (req: Request) => new Response(req.path + "|" + req.url)));
  while (found.port.load() === 0) await sleep(1);
  const port = found.port.load();
  const tricked = await ask(port, "GET /public HTTP/1.1\r\nHost: a/admin#\r\nConnection: close\r\n\r\n");
  console.log("path from host|" + tricked.split("\r\n")[0]);
  const none = await ask(port, "GET /public HTTP/1.1\r\nConnection: close\r\n\r\n");
  console.log("no host|" + none.split("\r\n")[0]);
  const two = await ask(port, "GET /public HTTP/1.1\r\nHost: a\r\nHost: b\r\nConnection: close\r\n\r\n");
  console.log("two hosts|" + two.split("\r\n")[0]);
  const old = await ask(port, "GET /public HTTP/1.0\r\n\r\n");
  console.log("1.0 without host|" + old.split("\r\n\r\n")[1].replace(String(port), "PORT"));
  const plain = await ask(port, "GET /public HTTP/1.1\r\nHost: example.test:8080\r\nConnection: close\r\n\r\n");
  console.log("plain host|" + plain.split("\r\n\r\n")[1]);
}
// case: http_idle
// expect: closed after idling
// A connection that sends nothing is closed after 5 seconds.
async function main(): Promise<void> throws IoError {
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => new Response("hi")));
  while (found.port.load() === 0) await sleep(1);
  const conn = await TcpStream.connect("127.0.0.1", found.port.load());
  try {
    const got = await conn.read(16, AbortSignal.timeout(8000));
    if (got.length === 0) console.log("closed after idling");
  } catch (e) {
    console.log("still open after 8 seconds");
  }
}
// case: http_limits
// expect: big head|HTTP/1.1 431 Request Header Fields Too Large|true
// expect: big body|HTTP/1.1 413 Content Too Large|true
// expect: garbage|HTTP/1.1 400 Bad Request|true
// expect: http/2|HTTP/1.1 400 Bad Request|true
// expect: no colon|HTTP/1.1 400 Bad Request|true
// expect: space before colon|HTTP/1.1 400 Bad Request|true
// expect: bad length|HTTP/1.1 400 Bad Request|true
// expect: chunked|HTTP/1.1 501 Not Implemented|true
// expect: still serving|HTTP/1.1 200 OK|false
// Requests the server won't serve get their status and a closed connection; others go on.
async function ask(port: i64, raw: string): Promise<string> throws IoError {
  const conn = await TcpStream.connect("127.0.0.1", port);
  await conn.write(new TextEncoder().encode(raw));
  let all: u8[] = [];
  while (true) {
    const got = await conn.read(4096);
    if (got.length === 0) break;
    for (const b of got) all.push(b);
  }
  return new TextDecoder().decode(all);
}

async function check(port: i64, label: string, raw: string): Promise<void> throws IoError {
  const text = await ask(port, raw);
  console.log(label + "|" + text.split("\r\n")[0] + "|" + String(text.includes("connection: close")));
}

async function main(): Promise<void> throws IoError {
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => new Response("ok")));
  while (found.port.load() === 0) await sleep(1);
  const port = found.port.load();
  await check(port, "big head", "GET / HTTP/1.1\r\nHost: h\r\nX-Big: " + "a".repeat(16500) + "\r\n\r\n");
  await check(port, "big body", "POST / HTTP/1.1\r\nHost: h\r\nContent-Length: 2000000\r\n\r\n");
  await check(port, "garbage", "GARBAGE\r\n\r\n");
  await check(port, "http/2", "GET / HTTP/2.0\r\n\r\n");
  await check(port, "no colon", "GET / HTTP/1.1\r\nHost\r\n\r\n");
  await check(port, "space before colon", "GET / HTTP/1.1\r\nHost : x\r\n\r\n");
  await check(port, "bad length", "POST / HTTP/1.1\r\nHost: h\r\nContent-Length: 12x\r\n\r\n");
  await check(port, "chunked", "POST / HTTP/1.1\r\nHost: h\r\nTransfer-Encoding: chunked\r\n\r\n");
  const conn = await TcpStream.connect("127.0.0.1", port);
  await conn.write(new TextEncoder().encode("GET / HTTP/1.1\r\nHost: h\r\n\r\n"));
  const got = await conn.read(4096);
  const text = new TextDecoder().decode(got);
  console.log("still serving|" + text.split("\r\n")[0] + "|" + String(text.includes("connection: close")));
}
// case: http_names_without_http
// expect: 1 2 3
// expect: 0
// Names that only look like the HTTP library's, in a program with a sync main, leave it out.
class Server {
  serve(): i64 { return 1; }
}
type T = { Response: i64 };
function main() {
  const o = { serve: 2 };
  const t: T = { Response: 3 };
  console.log(new Server().serve(), o.serve, t.Response);
  const Headers = 0;
  console.log(Headers);
}
// case: http_own_fetch
// expect: mine /a
// expect: listening
// A program's own fetch beside serve is the one it calls, and the HTTP library stays.
function fetch(path: string): string { return "mine " + path; }
async function main(): Promise<void> {
  console.log(fetch("/a"));
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req) => new Response("hi")));
  while (found.port.load() === 0) await sleep(1);
  console.log("listening");
}
// case: http_own_fetch_const
// expect: mine 200
// A program's own fetch constant beside the HTTP library is the one it reads.
const fetch = "mine";
async function main(): Promise<void> {
  console.log(fetch, new Response("hi").status);
}
// case: http_own_fetch_const_alone
// expect: mine
// A program's own fetch constant, with no HTTP library, is the one it reads.
const fetch = "mine";
function main() {
  console.log(fetch);
}
// case: http_own_names
// expect: mine /a
// A program declaring its own Request doesn't get the std HTTP library, so nothing clashes.
class Request { path: string; constructor(path: string) { this.path = path; } }
function main() {
  const r = new Request("/a");
  console.log("mine", r.path);
}
// case: http_router
// expect: 200 user 7 posts
// expect: 201 made
// expect: 200 user 9 posts
// expect: 404 Not Found
// expect: 404 Not Found
// expect: 404 Not Found
// expect: 200 first
// expect: 200 any PUT
// expect: 200 deleted 3
// expect: 200 empty
// A Router picks the first route matching a request's method and path, reads its :params,
// runs GET routes for HEAD, and gives 404 for the rest.
async function show(app: Ref<Router>, method: string, url: string): Promise<void> {
  const res = await app.handle(new Request(url, { method: method }));
  const body = await res.text();
  console.log(res.status, body.trim());
}

async function main(): Promise<void> {
  let app = new Router();
  app.get("/users/:id/:what", async (req) => new Response("user " + req.param("id") + " " + req.param("what")));
  app.post("/users", async (req) => new Response("made", { status: 201 }));
  app.get("/twice", async (req) => new Response("first"));
  app.get("/twice", async (req) => new Response("second"));
  app.all("/any", async (req) => new Response("any " + req.method));
  app.delete("/items/:n", async (req) => new Response("deleted " + req.param("n")));
  app.get("/empty", async (req) => new Response(req.param("nope") === "" ? "empty" : "?"));
  await show(app, "GET", "http://h/users/7/posts");
  await show(app, "POST", "http://h/users");
  await show(app, "HEAD", "http://h/users/9/posts");
  await show(app, "GET", "http://h/users");
  await show(app, "POST", "http://h/users/7/posts");
  await show(app, "GET", "http://h/users//posts");
  await show(app, "GET", "http://h/twice");
  await show(app, "PUT", "http://h/any");
  await show(app, "DELETE", "http://h/items/3");
  await show(app, "GET", "http://h/empty");
}
// case: http_router_edges
// expect: no slash|ok
// expect: lowercase method|ok
// expect: head route|head
// expect: head falls back|get
// expect: first match for head|get x
// expect: repeated param|2
// expect: query and fragment|a
// expect: trailing slash|Not Found
// Router edges: paths without a leading '/', methods in any case, HEAD routes, repeated
// :params, queries and trailing slashes.
async function show(app: Ref<Router>, label: string, method: string, url: string): Promise<void> {
  const res = await app.handle(new Request(url, { method: method }));
  const body = await res.text();
  console.log(label + "|" + body.trim());
}

async function main(): Promise<void> {
  let app = new Router();
  app.get("noslash", async (req) => new Response("ok"));
  app.route("post", "/lower", async (req) => new Response("ok"));
  app.route("HEAD", "/h", async (req) => new Response("head"));
  app.get("/h", async (req) => new Response("get"));
  app.get("/x", async (req) => new Response("get x"));
  app.all("/x", async (req) => new Response("all x"));
  app.get("/g", async (req) => new Response("get"));
  app.get("/a/:id/b/:id", async (req) => new Response(req.param("id")));
  app.get("/q/:x", async (req) => new Response(req.param("x")));
  app.get("/users", async (req) => new Response("users"));
  await show(app, "no slash", "GET", "http://h/noslash");
  await show(app, "lowercase method", "POST", "http://h/lower");
  await show(app, "head route", "HEAD", "http://h/h");
  await show(app, "head falls back", "HEAD", "http://h/g");
  await show(app, "first match for head", "HEAD", "http://h/x");
  await show(app, "repeated param", "GET", "http://h/a/1/b/2");
  await show(app, "query and fragment", "GET", "http://h/q/a?b=/c#d");
  await show(app, "trailing slash", "GET", "http://h/users/");
}
// case: http_router_serve
// expect: HTTP/1.1 200 OK|user 7
// expect: HTTP/1.1 201 Created|made alice
// expect: HTTP/1.1 404 Not Found|Not Found
// expect: served 50
// A Router handed to serve answers routed requests from raw clients and 404s the rest.
async function ask(port: i64, raw: string): Promise<string> throws IoError {
  const conn = await TcpStream.connect("127.0.0.1", port);
  await conn.write(new TextEncoder().encode(raw));
  let all: u8[] = [];
  while (true) {
    const got = await conn.read(4096);
    if (got.length === 0) break;
    for (const b of got) all.push(b);
  }
  return new TextDecoder().decode(all);
}

function line(text: string): string {
  const parts = text.split("\r\n\r\n");
  return parts[0].split("\r\n")[0] + "|" + parts[1].trim();
}

async function many(port: i64, i: i64): Promise<i64> {
  try {
    const text = await ask(port, "GET /users/" + String(i) + " HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n");
    return text.endsWith("user " + String(i)) ? 1 : 0;
  } catch (e) {
    return 0;
  }
}

async function main(): Promise<void> throws IoError {
  let app = new Router();
  app.get("/users/:id", async (req) => new Response("user " + req.param("id")));
  app.post("/users", async (req) => {
    const name = await req.text();
    return new Response("made " + name, { status: 201 });
  });
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info) => { seen.port.store(info.port); } }, app.handler()));
  while (found.port.load() === 0) await sleep(1);
  const port = found.port.load();
  const a = await ask(port, "GET /users/7 HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n");
  console.log(line(a));
  const b = await ask(port, "POST /users HTTP/1.1\r\nHost: h\r\nContent-Length: 5\r\nConnection: close\r\n\r\nalice");
  console.log(line(b));
  const c = await ask(port, "GET /nowhere HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n");
  console.log(line(c));
  let handles: JoinHandle<i64>[] = [];
  for (let i = 0; i < 50; i++) handles.push(spawn(many(port, i)));
  let served: i64 = 0;
  while (handles.length > 0) {
    const h = handles.pop()!;
    const ok = await h;
    served += ok;
  }
  console.log("served " + String(served));
}
// case: http_serve
// expect: HTTP/1.1 200 OK|GET /hello http://example.test/hello?x=1 
// expect: HTTP/1.1 200 OK|POST /echo http://h/echo hello|true|true|true
// expect: keep-alive|GET /one |GET /two |false
// expect: http/1.0 closes|true
// expect: head|true|true
// expect: served 50
// The std server answering raw HTTP/1.x from TcpStream clients.
async function readAll(conn: TcpStream): Promise<string> throws IoError {
  let all: u8[] = [];
  while (true) {
    const got = await conn.read(4096);
    if (got.length === 0) break;
    for (const b of got) all.push(b);
  }
  return new TextDecoder().decode(all);
}

async function ask(port: i64, raw: string): Promise<string> throws IoError {
  const conn = await TcpStream.connect("127.0.0.1", port);
  await conn.write(new TextEncoder().encode(raw));
  const text = await readAll(conn);
  return text;
}

// One response off a connection that stays open: its head, then as many bytes as it says.
async function one(conn: Ref<TcpStream>, held: Mut<u8[]>): Promise<string> throws IoError {
  while (true) {
    const text = new TextDecoder().decode(held);
    const end = text.indexOf("\r\n\r\n");
    if (end >= 0) {
      const at = text.indexOf("content-length: ");
      const size = text.slice(at + 16, text.indexOf("\r\n", at));
      let n: i64 = 0;
      for (let i = 0; i < size.length; i++) n = n * 10 + (size.charCodeAt(i) as i64 - 48);
      if ((held.length as i64) >= end + 4 + n) {
        const whole = text.slice(0, end + 4 + n);
        let rest: u8[] = [];
        for (let i = (end + 4 + n) as usize; i < held.length; i++) rest.push(held[i]);
        held = rest;
        return whole;
      }
    }
    const got = await conn.read(4096);
    if (got.length === 0) return "closed early";
    for (const b of got) held.push(b);
  }
}

async function many(port: i64, i: i64): Promise<i64> {
  try {
    const text = await ask(port, "GET /n/" + String(i) + " HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n");
    return text.includes("\r\n\r\nGET /n/" + String(i) + " ") ? 1 : 0;
  } catch (e) {
    return 0;
  }
}

async function main(): Promise<void> throws IoError {
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => {
    const body = await req.text();
    return new Response(req.method + " " + req.path + " " + req.url + " " + body);
  }));
  while (found.port.load() === 0) await sleep(1);
  const port = found.port.load();

  const a = await ask(port, "GET /hello?x=1 HTTP/1.1\r\nHost: example.test\r\nConnection: close\r\n\r\n");
  const lines = a.split("\r\n");
  console.log(lines[0] + "|" + lines[lines.length - 1]);

  const b = await ask(port, "POST /echo HTTP/1.1\r\nHost: h\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello");
  const blines = b.split("\r\n");
  console.log(blines[0] + "|" + blines[blines.length - 1] + "|" + String(b.includes("content-length: 30\r\n")) + "|" + String(b.includes("content-type: text/plain;charset=UTF-8")) + "|" + String(b.includes("date: ")));

  // Two requests on one connection, sent together, answered in turn.
  const conn = await TcpStream.connect("127.0.0.1", port);
  await conn.write(new TextEncoder().encode("GET /one HTTP/1.1\r\nHost: h\r\n\r\nGET /two HTTP/1.1\r\nHost: h\r\n\r\n"));
  let held: u8[] = [];
  const first = await one(conn, held);
  const second = await one(conn, held);
  const r1 = first.split("\r\n");
  const r2 = second.split("\r\n");
  console.log("keep-alive|" + r1[r1.length - 1].slice(0, 9) + "|" + r2[r2.length - 1].slice(0, 9) + "|" + String(second.includes("connection: close")));

  const old = await ask(port, "GET /old HTTP/1.0\r\n\r\n");
  console.log("http/1.0 closes|" + String(old.includes("connection: close")));

  const head = await ask(port, "HEAD /h HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n");
  console.log("head|" + String(head.endsWith("\r\n\r\n")) + "|" + String(!head.includes("content-length: 0\r\n")));

  let handles: JoinHandle<i64>[] = [];
  for (let i = 0; i < 50; i++) handles.push(spawn(many(port, i)));
  let served: i64 = 0;
  while (handles.length > 0) {
    const h = handles.pop()!;
    const ok = await h;
    served += ok;
  }
  console.log("served " + String(served));
}
// case: http_shutdown
// expect: handler saw the client leave
// expect: slow response|HTTP/1.1 200 OK|slow done
// expect: idle connection closed
// expect: serve returned
// A request's signal aborts when its client goes away; aborting the server's signal stops it
// once the request in flight is answered, closing idle connections.
async function readAll(conn: Ref<TcpStream>): Promise<string> throws IoError {
  let all: u8[] = [];
  while (true) {
    const got = await conn.read(4096);
    if (got.length === 0) break;
    for (const b of got) all.push(b);
  }
  return new TextDecoder().decode(all);
}

async function slow(port: i64): Promise<string> throws IoError {
  const conn = await TcpStream.connect("127.0.0.1", port);
  await conn.write(new TextEncoder().encode("GET /slow HTTP/1.1\r\nHost: h\r\n\r\n"));
  const text = await readAll(conn);
  return text;
}

async function main(): Promise<void> throws IoError {
  const state = shared({ port: new Atomic(0), left: new Atomic(0), busy: new Atomic(0) });
  const seen = state.clone();
  const watched = state.clone();
  const ctl = new AbortController();
  const server = spawn(serve({ port: 0, hostname: "127.0.0.1", signal: ctl.signal, onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => {
    if (req.path === "/wait") {
      while (!req.signal.aborted) await sleep(5);
      watched.left.store(1);
      return new Response("gone");
    }
    if (req.path === "/first") return new Response("first");
    watched.busy.store(1);
    await sleep(100);
    return new Response("slow done");
  }));
  while (state.port.load() === 0) await sleep(1);
  const port = state.port.load();

  {
    const conn = await TcpStream.connect("127.0.0.1", port);
    await conn.write(new TextEncoder().encode("GET /wait HTTP/1.1\r\nHost: h\r\n\r\n"));
    await sleep(20);
  }
  while (state.left.load() === 0) await sleep(5);
  console.log("handler saw the client leave");

  // An idle keep-alive connection, and a request still being handled when the server stops.
  const idle = await TcpStream.connect("127.0.0.1", port);
  await idle.write(new TextEncoder().encode("GET /first HTTP/1.1\r\nHost: h\r\n\r\n"));
  const first = await idle.read(4096);
  const answer = spawn(slow(port));
  while (state.busy.load() === 0) await sleep(1);
  ctl.abort();
  const text = await answer;
  const lines = text.split("\r\n");
  console.log("slow response|" + lines[0] + "|" + lines[lines.length - 1]);
  const rest = await readAll(idle);
  if (rest.length === 0) console.log("idle connection closed");
  await server;
  console.log("serve returned");
}
// case: http_stop_partial
// expect: serve returned
// expect: client closed
// A client part way through a request doesn't keep a stopping server waiting.
async function main(): Promise<void> throws IoError {
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  const ctl = new AbortController();
  const server = spawn(serve({ port: 0, hostname: "127.0.0.1", signal: ctl.signal, onListen: (info) => { seen.port.store(info.port); } }, async (req: Request) => new Response("hi")));
  while (found.port.load() === 0) await sleep(1);
  const conn = await TcpStream.connect("127.0.0.1", found.port.load());
  // A whole request first, answered, so the connection is surely being served.
  await conn.write(new TextEncoder().encode("GET / HTTP/1.1\r\nHost: h\r\n\r\n"));
  const answer = await conn.read(4096);
  await conn.write(new TextEncoder().encode("POST / HTTP/1.1\r\nHost: h\r\nContent-Length: 100\r\n\r\nabc"));
  await sleep(20);
  ctl.abort();
  await server;
  console.log("serve returned");
  const got = await conn.read(64);
  if (got.length === 0) console.log("client closed");
}
// case: http_sync_main
// expect: text/plain;charset=UTF-8 x
// Request, Response and Headers work in a program whose main isn't async.
function main() {
  let h = new Headers();
  h.set("x", "x");
  const res = new Response("hi", { headers: h });
  console.log(res.headers.get("content-type") ?? "", res.headers.get("x") ?? "");
}
// case: http_user_builtins
// expect: 3 4
// expect: 200
// A program's own spawn and sleep don't change what the std HTTP library calls.
function spawn(n: i64): i64 { return n + 1; }
function sleep(n: i64): i64 { return n + 2; }
async function main(): Promise<void> {
  console.log(spawn(2), sleep(2));
  const res = new Response("hi");
  console.log(res.status);
}
// case: http_wire
// expect: injected header|HTTP/1.1 500 Internal Server Error|false
// expect: injected status text|HTTP/1.1 500 Internal Server Error|false
// expect: bad status|HTTP/1.1 500 Internal Server Error|false
// expect: 204|HTTP/1.1 204 No Content|false|true
// expect: own framing|HTTP/1.1 200 OK|false
// expect: bare LF|HTTP/1.1 400 Bad Request
// expect: bare CR|HTTP/1.1 400 Bad Request
// expect: connection list|true
// expect: 1.0 keep-alive|true|true
// expect: continue|HTTP/1.1 100 Continue|true
// The server's rules for what goes on the wire: responses it won't send as they stand, line
// breaks in requests, Connection lists, HTTP/1.0 keep-alive and 100-continue.
async function readAll(conn: Ref<TcpStream>): Promise<string> throws IoError {
  let all: u8[] = [];
  while (true) {
    const got = await conn.read(4096);
    if (got.length === 0) break;
    for (const b of got) all.push(b);
  }
  return new TextDecoder().decode(all);
}

async function ask(port: i64, raw: string): Promise<string> throws IoError {
  const conn = await TcpStream.connect("127.0.0.1", port);
  await conn.write(new TextEncoder().encode(raw));
  const text = await readAll(conn);
  return text;
}

async function get(port: i64, path: string): Promise<string> throws IoError {
  const text = await ask(port, "GET " + path + " HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n");
  return text;
}

async function main(): Promise<void> throws IoError {
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info) => { seen.port.store(info.port); } }, async (req: Request) => {
    let headers = new Headers();
    if (req.path === "/header") headers.set("x-evil", "a\r\nset-cookie: pwned=1");
    if (req.path === "/te") headers.set("transfer-encoding", "chunked");
    if (req.path === "/status-text") return new Response("x", { statusText: "OK\r\nx-status: injected" });
    if (req.path === "/bad-status") return new Response("x", { status: 7 });
    if (req.path === "/204") return new Response("body!", { status: 204 });
    const body = await req.text();
    return new Response(req.method + " " + req.path + " " + body, { headers: headers });
  }));
  while (found.port.load() === 0) await sleep(1);
  const port = found.port.load();

  const header = await get(port, "/header");
  console.log("injected header|" + header.split("\r\n")[0] + "|" + String(header.includes("pwned")));
  const statusText = await get(port, "/status-text");
  console.log("injected status text|" + statusText.split("\r\n")[0] + "|" + String(statusText.includes("injected")));
  const bad = await get(port, "/bad-status");
  console.log("bad status|" + bad.split("\r\n")[0] + "|" + String(bad.includes("HTTP/1.1 7 ")));
  const empty = await get(port, "/204");
  console.log("204|" + empty.split("\r\n")[0] + "|" + String(empty.includes("body!")) + "|" + String(empty.endsWith("\r\n\r\n")));
  const te = await get(port, "/te");
  console.log("own framing|" + te.split("\r\n")[0] + "|" + String(te.includes("transfer-encoding")));

  const lf = await ask(port, "POST / HTTP/1.1\r\nHost: h\r\nX: a\nContent-Length: 5\r\n\r\nhello");
  console.log("bare LF|" + lf.split("\r\n")[0]);
  const cr = await ask(port, "GET / HTTP/1.1\r\nHost: h\r\nX: a\rb\r\n\r\n");
  console.log("bare CR|" + cr.split("\r\n")[0]);

  const listed = await ask(port, "GET / HTTP/1.1\r\nHost: h\r\nConnection: close, TE\r\n\r\n");
  console.log("connection list|" + String(listed.includes("connection: close")));

  // A 1.0 client asking to keep the connection is told it is kept, and can send another request.
  const old = await TcpStream.connect("127.0.0.1", port);
  await old.write(new TextEncoder().encode("GET /one HTTP/1.0\r\nConnection: keep-alive\r\n\r\n"));
  const firstBytes = await old.read(4096);
  const first = new TextDecoder().decode(firstBytes);
  await old.write(new TextEncoder().encode("GET /two HTTP/1.0\r\n\r\n"));
  const second = await readAll(old);
  console.log("1.0 keep-alive|" + String(first.includes("connection: keep-alive")) + "|" + String(second.includes("\r\n\r\nGET /two ")));

  const slow = await TcpStream.connect("127.0.0.1", port);
  await slow.write(new TextEncoder().encode("POST /c HTTP/1.1\r\nHost: h\r\nExpect: 100-Continue\r\nContent-Length: 2\r\nConnection: close\r\n\r\n"));
  const interimBytes = await slow.read(4096);
  const interim = new TextDecoder().decode(interimBytes);
  await slow.write(new TextEncoder().encode("hi"));
  const rest = await readAll(slow);
  console.log("continue|" + interim.split("\r\n")[0] + "|" + String(rest.endsWith("POST /c hi")));
}
