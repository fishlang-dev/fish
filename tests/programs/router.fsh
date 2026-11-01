// case: router_middleware_logs
// expect: -> GET /users/7
// expect: <- 200
// expect: 200 user 7
// A middleware sees the request before the route runs and the response after.
async function main(): Promise<void> {
  let app = new Router();
  app.get("/users/:id", async (req) => new Response("user " + req.param("id")));
  app.use(async (req, next) => {
    console.log("->", req.method, req.path);
    const res = await next(req);
    console.log("<-", res.status);
    return res;
  });
  const res = await app.handle(new Request("http://h/users/7"));
  const body = await res.text();
  console.log(res.status, body);
}
// case: router_middleware_order
// expect: a in
// expect: b in
// expect: handler
// expect: b out
// expect: a out
// Middleware run in the order they were added, the first outermost.
async function main(): Promise<void> {
  let app = new Router();
  app.use(async (req, next) => {
    console.log("a in");
    const res = await next(req);
    console.log("a out");
    return res;
  });
  app.use(async (req, next) => {
    console.log("b in");
    const res = await next(req);
    console.log("b out");
    return res;
  });
  app.get("/", async (req) => {
    console.log("handler");
    return new Response("ok");
  });
  const res = await app.handle(new Request("http://h/"));
}
// case: router_middleware_answers
// expect: 401 no token
// expect: handler ran
// expect: 200 secret
// A middleware that doesn't call next answers alone, and the route never runs.
async function show(app: Ref<Router>, req: Request): Promise<void> {
  const res = await app.handle(req);
  const body = await res.text();
  console.log(res.status, body);
}

async function main(): Promise<void> {
  let app = new Router();
  app.use(async (req, next) => {
    if (!req.headers.has("authorization")) return new Response("no token", { status: 401 });
    const res = await next(req);
    return res;
  });
  app.get("/secret", async (req) => {
    console.log("handler ran");
    return new Response("secret");
  });
  await show(app, new Request("http://h/secret"));
  let headers = new Headers();
  headers.set("authorization", "Bearer x");
  await show(app, new Request("http://h/secret", { headers: headers }));
}
// case: router_middleware_headers
// expect: 200 hello alice
// expect: x-served-by fish
// A middleware adds a request header the route reads and a response header the caller sees.
async function main(): Promise<void> {
  let app = new Router();
  app.use(async (req, next) => {
    let changed = req;
    changed.headers.set("x-user", "alice");
    let res = await next(changed);
    res.headers.set("x-served-by", "fish");
    return res;
  });
  app.get("/", async (req) => new Response("hello " + (req.headers.get("x-user") ?? "nobody")));
  const res = await app.handle(new Request("http://h/"));
  const body = await res.text();
  console.log(res.status, body);
  console.log("x-served-by", res.headers.get("x-served-by") ?? "missing");
}
// case: router_middleware_rewrite
// expect: 200 new 5
// expect: 200 other
// A middleware rewriting the path makes a different route match, with its params.
async function show(app: Ref<Router>, url: string): Promise<void> {
  const res = await app.handle(new Request(url));
  const body = await res.text();
  console.log(res.status, body);
}

async function main(): Promise<void> {
  let app = new Router();
  app.use(async (req, next) => {
    let moved = req;
    if (moved.path.startsWith("/old/")) moved.path = "/new/" + moved.path.slice(5);
    const res = await next(moved);
    return res;
  });
  app.get("/new/:n", async (req) => new Response("new " + req.param("n")));
  app.get("/old/:n", async (req) => new Response("old " + req.param("n")));
  app.get("/other", async (req) => new Response("other"));
  await show(app, "http://h/old/5");
  await show(app, "http://h/other");
}
// case: router_middleware_after_routes
// expect: seen GET /a
// expect: 200 a
// expect: seen GET /nowhere
// expect: 404 Not Found
// expect: seen HEAD /a
// expect: 200 a
// Middleware added after the routes still wraps them, the 404 and a HEAD request to a GET route.
async function show(app: Ref<Router>, method: string, url: string): Promise<void> {
  const res = await app.handle(new Request(url, { method: method }));
  const body = await res.text();
  console.log(res.status, body.trim());
}

async function main(): Promise<void> {
  let app = new Router();
  app.get("/a", async (req) => new Response("a"));
  app.use(async (req, next) => {
    console.log("seen", req.method, req.path);
    const res = await next(req);
    return res;
  });
  await show(app, "GET", "http://h/a");
  await show(app, "GET", "http://h/nowhere");
  await show(app, "HEAD", "http://h/a");
}
// case: router_middleware_serve
// expect: 200 hello|request 1|slow before after
// expect: 200 hello|request 2|slow before after
// expect: 200 run 3 then run 4|request 3|slow before after
// expect: 404 Not Found|request 4|slow before after
// expect: handler runs 4
// A served router's middleware keeps a count in a shared value across requests, awaits before and
// after next, and runs the route twice when it calls next twice.
async function get(port: i64, path: string): Promise<void> throws IoError | AbortError {
  const res = await fetch("http://127.0.0.1:" + String(port) + path);
  const body = await res.text();
  console.log(res.status, body.trim() + "|" + (res.headers.get("x-count") ?? "") + "|" + (res.headers.get("x-slow") ?? ""));
}

async function main(): Promise<void> throws IoError | AbortError {
  const hits = shared({ n: new Atomic(0) });
  const runs = shared({ n: new Atomic(0) });
  const counted = hits.clone();
  const ran = runs.clone();
  const ranTwice = runs.clone();
  let app = new Router();
  app.use(async (req, next) => {
    counted.n.add(1);
    let res = await next(req);
    res.headers.set("x-count", "request " + String(counted.n.load()));
    return res;
  });
  app.use(async (req, next) => {
    await sleep(1);
    let note = "slow before";
    let res = await next(req);
    await sleep(1);
    note += " after";
    res.headers.set("x-slow", note);
    return res;
  });
  app.use(async (req, next) => {
    if (req.path !== "/twice") {
      const res = await next(req);
      return res;
    }
    const first = await next(req.clone());
    const a = await first.text();
    const second = await next(req);
    const b = await second.text();
    return new Response(a + " then " + b);
  });
  app.get("/hello", async (req) => {
    ran.n.add(1);
    return new Response("hello");
  });
  app.get("/twice", async (req) => {
    ranTwice.n.add(1);
    return new Response("run " + String(ranTwice.n.load()));
  });
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info) => { seen.port.store(info.port); } }, app.handler()));
  while (found.port.load() === 0) await sleep(1);
  const port = found.port.load();
  await get(port, "/hello");
  await get(port, "/hello");
  await get(port, "/twice");
  await get(port, "/nowhere");
  console.log("handler runs", runs.n.load());
}
// case: router_middleware_own_names
// expect: ok 1 2
// A program's own Next, Middleware and RouterTable leave the router and its middleware working.
type Next = { n: i64 };
type Middleware = { m: i64 };
class RouterTable { x = 2; }
async function main(): Promise<void> {
  const n: Next = { n: 1 };
  let app = new Router();
  app.use(async (req, next) => {
    let res = await next(req);
    res.headers.set("x-n", String(n.n));
    return res;
  });
  app.get("/", async (req) => new Response("ok"));
  const res = await app.handle(new Request("http://h/"));
  const body = await res.text();
  console.log(body, res.headers.get("x-n") ?? "", new RouterTable().x);
}
// case: router_clone
// error: can't clone a value holding a Dyn
// A Router can't be cloned: clones would share one table of routes.
function main() {
  let app = new Router();
  const copy = app.clone();
}
// case: router_decoded_params
// expect: 200 café /users/caf%C3%A9
// expect: 400 Bad Request
// expect: 400 Bad Request
// expect: middleware ran
// expect: 200 100% /users/100%25
// A :param arrives percent-decoded as UTF-8; one that isn't is answered 400 before any
// middleware or handler runs.
async function main(): Promise<void> {
  let app = new Router();
  app.use(async (req, next) => {
    if (req.path !== "/users/caf%C3%A9") console.log("middleware ran");
    const res = await next(req);
    return res;
  });
  app.get("/users/:name", async (req) => new Response(req.param("name") + " " + req.path));
  for (const path of ["/users/caf%C3%A9", "/users/%E9", "/users/%zz", "/users/100%25"]) {
    const res = await app.handle(new Request("http://h" + path));
    const body = await res.text();
    console.log(res.status, body.trim());
  }
}
// case: router_bad_host
// expect: h 200 admin x
// expect: h:8080 200 admin x
// expect: h:abc 400 Bad Request
// expect: a^b 400 Bad Request
// expect: [::1 400 Bad Request
// expect: a%zz 400 Bad Request
// A Host header the URL parser refuses is answered 400, never routed with some other path.
async function ask(port: i64, host: string): Promise<string> throws IoError | AbortError {
  const conn = await TcpStream.connect("127.0.0.1", port, AbortSignal.timeout(2000));
  await conn.write(new TextEncoder().encode("GET /admin/x HTTP/1.1\r\nHost: " + host + "\r\nConnection: close\r\n\r\n"), AbortSignal.timeout(2000));
  let got: u8[] = [];
  while (true) {
    const more = await conn.read(4096, AbortSignal.timeout(2000));
    if (more.length === 0) break;
    for (const b of more) got.push(b);
  }
  const text = new TextDecoder().decode(got);
  const parts = text.split("\r\n\r\n");
  return parts[0].split(" ")[1] + " " + parts[parts.length - 1].trim();
}

async function main(): Promise<void> throws IoError | AbortError {
  let app = new Router();
  app.get("/", async (req) => new Response("root"));
  app.get("/admin/:x", async (req) => new Response("admin " + req.param("x")));
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, app.handler()));
  while (found.port.load() === 0) await sleep(1);
  for (const host of ["h", "h:8080", "h:abc", "a^b", "[::1", "a%zz"]) {
    const said = await ask(found.port.load(), host);
    console.log(host, said);
  }
}
// case: router_own_url
// expect: 200 mine: /x
// A program's own URL and URLSearchParams classes work beside the HTTP library, which keeps
// std's under names no program can write.
class URL {
  constructor(public text: string) {}
  describe(): string { return "mine: " + this.text; }
}
class URLSearchParams {}
async function main(): Promise<void> {
  let app = new Router();
  app.get("/x", async (req) => new Response(new URL(req.path).describe()));
  const res = await app.handle(new Request("http://h/x"));
  const body = await res.text();
  console.log(res.status, body);
}
// case: router_groups_serve
// expect: GET /health 200 ok|-|app
// expect: GET /users/7 200 user 7|users|app
// expect: GET /users/7/posts 200 posts of 7|users posts|app
// expect: GET /users/7/posts/3 200 post 3 of user 7|users posts|app
// expect: POST /users/7/posts 201 made for 7|users posts|app
// expect: HEAD /users/7/posts/3 200 |users posts|app
// expect: GET /users/7/nothing 404 Not Found|-|app
// expect: GET /users/7/posts/3/x 404 Not Found|-|app
// expect: GET /users 404 Not Found|-|app
// expect: GET /users/7/after 200 after 7|-|app
// expect: GET /v1 200 v1 root|-|app
// expect: GET /v1/ping 200 pong|-|app
// expect: POST /lower 200 lowered|-|app
// A router mounted under a prefix, and another mounted inside it, serve their routes below the
// prefixes with the prefix's params, each group's middleware running inside the parent's for its
// own routes only; a path below a prefix that no route takes is the parent's 404.
async function ask(port: i64, method: string, path: string): Promise<void> throws IoError | AbortError {
  const res = await fetch("http://127.0.0.1:" + String(port) + path, { method: method });
  const body = await res.text();
  console.log(method, path, res.status, body.trim() + "|" + (res.headers.get("x-groups") ?? "-") + "|" + (res.headers.get("x-app") ?? "-"));
}

function tag(name: string): (req: Request, next: (req: Request) => Promise<Response>) => Promise<Response> {
  return async (req, next) => {
    let res = await next(req);
    const had = res.headers.get("x-groups");
    res.headers.set("x-groups", had === null ? name : name + " " + had);
    return res;
  };
}

async function main(): Promise<void> throws IoError | AbortError {
  let posts = new Router();
  posts.use(tag("posts"));
  posts.get("/", async (req) => new Response("posts of " + req.param("id")));
  posts.get("/:pid", async (req) => new Response("post " + req.param("pid") + " of user " + req.param("id")));
  posts.post("/", async (req) => new Response("made for " + req.param("id"), { status: 201 }));
  let users = new Router();
  users.get("/", async (req) => new Response("user " + req.param("id")));
  users.route("/posts", posts);
  users.use(tag("users"));
  let v1 = new Router();
  v1.get("/", async (_req) => new Response("v1 root"));
  v1.get("ping", async (_req) => new Response("pong"));
  let app = new Router();
  app.use(async (req, next) => {
    let res = await next(req);
    res.headers.set("x-app", "app");
    return res;
  });
  app.get("/health", async (_req) => new Response("ok"));
  app.route("/users/:id", users);
  app.get("/users/:id/after", async (req) => new Response("after " + req.param("id")));
  app.route("v1/", v1);
  app.route("post", "/lower", async (_req) => new Response("lowered"));
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, app.handler()));
  while (found.port.load() === 0) await sleep(1);
  const port = found.port.load();
  await ask(port, "GET", "/health");
  await ask(port, "GET", "/users/7");
  await ask(port, "GET", "/users/7/posts");
  await ask(port, "GET", "/users/7/posts/3");
  await ask(port, "POST", "/users/7/posts");
  await ask(port, "HEAD", "/users/7/posts/3");
  await ask(port, "GET", "/users/7/nothing");
  await ask(port, "GET", "/users/7/posts/3/x");
  await ask(port, "GET", "/users");
  await ask(port, "GET", "/users/7/after");
  await ask(port, "GET", "/v1");
  await ask(port, "GET", "/v1/ping");
  await ask(port, "POST", "/lower");
}
// case: router_groups_static
// expect: /api/files/a.txt 200 file|assets
// expect: /api/files 200 index|assets
// expect: /api/files/ 200 index|assets
// expect: /api/files/b 200 b|assets
// expect: /api/files/missing 200 parent route|-
// expect: /api/files/.env 200 parent .env|-
// expect: /api/files/..%2fa.txt 404 Not Found|-
// expect: /api/files/nothing 404 Not Found|-
// expect: /api 404 Not Found|-
// A static route in a router mounted two levels down serves its files under the combined prefix,
// and a miss or a refusal there falls through to the parent's later routes, ending in the same 404.
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";

async function show(app: Ref<Router>, path: string): Promise<void> {
  const res = await app.handle(new Request("http://h" + path));
  const body = await res.text();
  console.log(path, res.status, body.trim() + "|" + (res.headers.get("x-group") ?? "-"));
}

async function main(): Promise<void> throws IoError {
  const dir = mkdtempSync("/tmp/fish-static-");
  writeFileSync(dir + "/a.txt", "file");
  writeFileSync(dir + "/index.html", "index");
  writeFileSync(dir + "/.env", "KEY=1");
  let assets = new Router();
  assets.use(async (req, next) => {
    let res = await next(req);
    res.headers.set("x-group", "assets");
    return res;
  });
  assets.static("/", dir);
  assets.get("/b", async (_req) => new Response("b"));
  let api = new Router();
  api.route("/files", assets);
  let app = new Router();
  app.route("/api", api);
  app.get("/api/files/missing", async (_req) => new Response("parent route"));
  app.get("/api/files/.env", async (_req) => new Response("parent .env"));
  for (const path of ["/api/files/a.txt", "/api/files", "/api/files/", "/api/files/b", "/api/files/missing", "/api/files/.env", "/api/files/..%2fa.txt", "/api/files/nothing", "/api"]) await show(app, path);
  rmSync(dir, { recursive: true });
}
// case: router_groups_rewrite
// expect: /api/old 401 no token
// expect: /api/old 200 secret
// expect: /api/new 200 new
// A group's middleware that changes the path has the request routed again, through the middleware
// of the group the new path belongs to.
async function show(app: Ref<Router>, path: string, token: boolean): Promise<void> {
  let headers = new Headers();
  if (token) headers.set("authorization", "Bearer x");
  const res = await app.handle(new Request("http://h" + path, { headers: headers }));
  const body = await res.text();
  console.log(path, res.status, body.trim());
}

async function main(): Promise<void> {
  let admin = new Router();
  admin.use(async (req, next) => {
    if (!req.headers.has("authorization")) return new Response("no token", { status: 401 });
    const res = await next(req);
    return res;
  });
  admin.get("/secret", async (_req) => new Response("secret"));
  let api = new Router();
  api.use(async (req, next) => {
    let moved = req;
    if (moved.path === "/api/old") moved.path = "/admin/secret";
    const res = await next(moved);
    return res;
  });
  api.get("/old", async (_req) => new Response("old"));
  api.get("/new", async (_req) => new Response("new"));
  let app = new Router();
  app.route("/api", api);
  app.route("/admin", admin);
  await show(app, "/api/old", false);
  await show(app, "/api/old", true);
  await show(app, "/api/new", false);
}
// case: router_groups_moved
// error: 'api' was moved, so it can't be used here
// Mounting a router moves it in, so routes can't be added to it afterwards.
function main() {
  let api = new Router();
  let app = new Router();
  app.route("/api", api);
  api.get("/x", async (_req) => new Response("x"));
}
// case: router_route_arguments
// error: no overload of 'Router.route' takes ("GET", "/api")
// A route needs its handler; a router to mount is the only two-argument form.
function main() {
  let app = new Router();
  app.route("GET", "/api");
}
// case: router_groups_loop
// expect: /g/a 500 Internal Server Error
// expect: /ok 200 ok
// Group middleware that keep rewriting a request between each other's routes are stopped with a
// 500 after a few re-routes, and the server goes on serving.
async function get(port: i64, path: string): Promise<void> throws IoError | AbortError {
  const res = await fetch("http://127.0.0.1:" + String(port) + path);
  const body = await res.text();
  console.log(path, res.status, body.trim());
}

async function main(): Promise<void> throws IoError | AbortError {
  let g = new Router();
  g.use(async (req, next) => {
    let moved = req;
    moved.path = moved.path === "/g/a" ? "/g/b" : "/g/a";
    const res = await next(moved);
    return res;
  });
  g.get("/a", async (_req) => new Response("a"));
  g.get("/b", async (_req) => new Response("b"));
  let app = new Router();
  app.route("/g", g);
  app.get("/ok", async (_req) => new Response("ok"));
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, app.handler()));
  while (found.port.load() === 0) await sleep(1);
  await get(found.port.load(), "/g/a");
  await get(found.port.load(), "/ok");
}
