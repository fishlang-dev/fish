// case: static_files_serve
// expect: /assets/a.txt 200 text/plain; charset=utf-8 hello
// expect: /assets/docs 200 text/html; charset=utf-8 <p>docs</p>
// expect: /assets/docs/ 200 text/html; charset=utf-8 <p>docs</p>
// expect: /assets/app.JS 200 text/javascript; charset=utf-8 run()
// expect: /assets/pic.png 200 image/png 4 bytes
// expect: /assets/data.bin 200 application/octet-stream 4 bytes
// expect: /assets/inner 200 text/plain; charset=utf-8 hello
// expect: /assets/caf%C3%A9.txt 200 text/plain; charset=utf-8 café
// expect: /relative/a.txt 200 text/plain; charset=utf-8 hello
// expect: /linked/a.txt 200 text/plain; charset=utf-8 hello
// expect: / 200 text/html; charset=utf-8 home
// expect: weak etag true last-modified true
// expect: if-none-match 304 0 bytes, same etag true
// expect: if-none-match list 304
// expect: if-none-match star 304
// expect: if-none-match other 200
// A directory's files are served with a type from the extension, a weak ETag and Last-Modified,
// index.html for a directory, a 304 for a matching If-None-Match, from a root given relative to
// the working directory or through a symlink.
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { relative } from "node:path";

async function get(port: i64, path: string, tag: string): Promise<Response> throws IoError | AbortError {
  let headers = new Headers();
  if (tag !== "") headers.set("if-none-match", tag);
  const res = await fetch("http://127.0.0.1:" + String(port) + path, { headers: headers });
  return res;
}

async function show(port: i64, path: string): Promise<void> throws IoError | AbortError {
  const res = await get(port, path, "");
  const type = res.headers.get("content-type") ?? "-";
  const binary = !type.includes("charset");
  const bytes = res.body.length;
  const text = await res.text();
  console.log(path, res.status, type, binary ? String(bytes) + " bytes" : text);
}

async function main(): Promise<void> throws IoError | AbortError {
  const dir = mkdtempSync("/tmp/fish-static-");
  spawnSync("mkdir", ["-p", dir + "/public/docs", dir + "/home"]);
  writeFileSync(dir + "/public/a.txt", "hello");
  writeFileSync(dir + "/public/docs/index.html", "<p>docs</p>");
  writeFileSync(dir + "/public/app.JS", "run()");
  writeFileSync(dir + "/public/pic.png", [137, 80, 78, 71]);
  writeFileSync(dir + "/public/data.bin", [0, 1, 2, 255]);
  writeFileSync(dir + "/public/café.txt", "café");
  writeFileSync(dir + "/home/index.html", "home");
  spawnSync("ln", ["-s", "a.txt", dir + "/public/inner"]);
  spawnSync("ln", ["-s", "public", dir + "/rootlink"]);
  let app = new Router();
  app.static("/assets", dir + "/public");
  app.static("relative/", relative(realpathSync("."), dir + "/public"));
  app.static("/linked", dir + "/rootlink");
  app.static("/", dir + "/home");
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, app.handler()));
  while (found.port.load() === 0) await sleep(1);
  const port = found.port.load();
  for (const path of ["/assets/a.txt", "/assets/docs", "/assets/docs/", "/assets/app.JS", "/assets/pic.png", "/assets/data.bin", "/assets/inner", "/assets/caf%C3%A9.txt", "/relative/a.txt", "/linked/a.txt", "/"]) {
    await show(port, path);
  }
  const first = await get(port, "/assets/a.txt", "");
  const tag = first.headers.get("etag") ?? "";
  const modified = first.headers.get("last-modified") ?? "";
  console.log("weak etag", tag.startsWith("W/\"") && tag.endsWith("\""), "last-modified", modified.endsWith(" GMT"));
  const again = await get(port, "/assets/a.txt", tag);
  console.log("if-none-match", again.status, again.body.length, "bytes, same etag", again.headers.get("etag") === tag);
  const listed = await get(port, "/assets/a.txt", "\"other\", " + tag.slice(2));
  console.log("if-none-match list", listed.status);
  const star = await get(port, "/assets/a.txt", "*");
  console.log("if-none-match star", star.status);
  const other = await get(port, "/assets/a.txt", "W/\"0-0\"");
  console.log("if-none-match other", other.status);
  rmSync(dir, { recursive: true });
}
// case: static_files_refused
// expect: GET /assets/a.txt 200
// expect: GET /assets/../secret 404
// expect: GET /assets/%2e%2e/secret 404
// expect: GET /assets/..%2fsecret 404
// expect: GET /assets/%2E%2E%2Fsecret 404
// expect: GET /assets/sub/..%2f..%2fsecret 404
// expect: GET /assets/..%5csecret 404
// expect: GET /assets/..\secret 404
// expect: GET /assets/a.txt%00.png 404
// expect: GET /assets/%2fetc%2fpasswd 404
// expect: GET /assets//etc/passwd 404
// expect: GET /assets/%zz 404
// expect: GET /assets/.env 404
// expect: GET /assets/sub/.hidden 404
// expect: GET /assets/out 404
// expect: GET /assets/escape/secret 404
// expect: GET /assets/sub 404
// expect: GET /assets/ 404
// expect: GET /assets/fifo 404
// expect: GET /assets/a.txt/ 404
// expect: GET /assets/outdex 404
// expect: GET /assets/outdex/ 404
// expect: GET /pub/sib 404
// expect: GET /pub/own.txt 200
// expect: GET /ASSETS/a.txt 404
// expect: GET /assetsx/a.txt 404
// expect: GET /missing/a.txt 404
// expect: POST /assets/a.txt 404
// Nothing outside the root is served, however the path is spelled: dot segments, encoded and
// Windows-style separators, NUL, empty segments, hidden files, symlinks leading out, a directory
// with no index.html, which is never listed, a file that isn't a regular one, a file named with a
// trailing slash, an index.html linking out, or a link into a sibling whose name starts with the
// root's. Each is a 404, so a refusal doesn't say whether the file exists. Requests are written
// raw, so no client cleans the path first.
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

async function ask(port: i64, method: string, target: string): Promise<string> throws IoError | AbortError {
  const conn = await TcpStream.connect("127.0.0.1", port, AbortSignal.timeout(2000));
  await conn.write(new TextEncoder().encode(method + " " + target + " HTTP/1.1\r\nHost: h\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"), AbortSignal.timeout(2000));
  let got: u8[] = [];
  while (true) {
    const more = await conn.read(4096, AbortSignal.timeout(2000));
    if (more.length === 0) break;
    for (const b of more) got.push(b);
  }
  const text = new TextDecoder().decode(got);
  return text.split("\r\n")[0].split(" ")[1];
}

async function main(): Promise<void> throws IoError | AbortError {
  const dir = mkdtempSync("/tmp/fish-static-");
  spawnSync("mkdir", ["-p", dir + "/public/sub"]);
  writeFileSync(dir + "/public/a.txt", "hello");
  writeFileSync(dir + "/public/.env", "KEY=1");
  writeFileSync(dir + "/public/sub/.hidden", "hidden");
  writeFileSync(dir + "/secret", "secret");
  spawnSync("ln", ["-s", "../secret", dir + "/public/out"]);
  spawnSync("ln", ["-s", "..", dir + "/public/escape"]);
  spawnSync("mkfifo", [dir + "/public/fifo"]);
  spawnSync("mkdir", ["-p", dir + "/public/outdex", dir + "/pub"]);
  spawnSync("ln", ["-s", "../../secret", dir + "/public/outdex/index.html"]);
  writeFileSync(dir + "/pub/own.txt", "own");
  spawnSync("ln", ["-s", "../public/a.txt", dir + "/pub/sib"]);
  let app = new Router();
  app.static("/assets", dir + "/public");
  app.static("/pub", dir + "/pub");
  app.static("/missing", dir + "/nowhere");
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, app.handler()));
  while (found.port.load() === 0) await sleep(1);
  const port = found.port.load();
  const targets = ["/assets/a.txt", "/assets/../secret", "/assets/%2e%2e/secret", "/assets/..%2fsecret", "/assets/%2E%2E%2Fsecret", "/assets/sub/..%2f..%2fsecret", "/assets/..%5csecret", "/assets/..\\secret", "/assets/a.txt%00.png", "/assets/%2fetc%2fpasswd", "/assets//etc/passwd", "/assets/%zz", "/assets/.env", "/assets/sub/.hidden", "/assets/out", "/assets/escape/secret", "/assets/sub", "/assets/", "/assets/fifo", "/assets/a.txt/", "/assets/outdex", "/assets/outdex/", "/pub/sib", "/pub/own.txt", "/ASSETS/a.txt", "/assetsx/a.txt", "/missing/a.txt"];
  for (const target of targets) {
    const status = await ask(port, "GET", target);
    console.log("GET", target, status);
  }
  const posted = await ask(port, "POST", "/assets/a.txt");
  console.log("POST /assets/a.txt", posted);
  rmSync(dir, { recursive: true });
}
// case: static_files_handle
// expect: 404 Not Found
// expect: 404 Not Found
// expect: 404 Not Found
// A request handed to the router directly, with no URL parser cleaning its path, is refused the
// same way.
async function main(): Promise<void> {
  let app = new Router();
  app.static("/assets", "/");
  for (const path of ["/assets/../etc/passwd", "/assets/%2e%2e/etc/passwd", "/assets/a/..%2f..%2fetc%2fpasswd"]) {
    let req = new Request("http://h/");
    req.path = path;
    const res = await app.handle(req);
    const body = await res.text();
    console.log(res.status, body.trim());
  }
}
// case: static_files_head
// expect: HTTP/1.1 200 OK
// expect: content-type: text/plain; charset=utf-8
// expect: content-length: 5
// expect: etag true
// expect: body 0
// A HEAD request gets a GET's headers and no body.
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";

async function main(): Promise<void> throws IoError | AbortError {
  const dir = mkdtempSync("/tmp/fish-static-");
  writeFileSync(dir + "/a.txt", "hello");
  let app = new Router();
  app.static("/", dir);
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, app.handler()));
  while (found.port.load() === 0) await sleep(1);
  const conn = await TcpStream.connect("127.0.0.1", found.port.load(), AbortSignal.timeout(2000));
  await conn.write(new TextEncoder().encode("HEAD /a.txt HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n"), AbortSignal.timeout(2000));
  let got: u8[] = [];
  while (true) {
    const more = await conn.read(4096, AbortSignal.timeout(2000));
    if (more.length === 0) break;
    for (const b of more) got.push(b);
  }
  const parts = new TextDecoder().decode(got).split("\r\n\r\n");
  const lines = parts[0].split("\r\n");
  console.log(lines[0]);
  for (const line of lines) {
    if (line.startsWith("content-length") || line.startsWith("content-type")) console.log(line);
  }
  console.log("etag", lines.some((l) => l.startsWith("etag: W/")));
  console.log("body", parts[1].length);
  rmSync(dir, { recursive: true });
}
// case: static_files_fall_through
// expect: /api 200 api
// expect: /a.txt 200 file
// expect: /.env 200 route .env
// expect: /old 200 api
// expect: /..%2fsecret 404 Not Found
// expect: /missing 404 Not Found
// expect: /a.txt/ 404 Not Found
// expect: HEAD /api 200 api
// A static route finding no file passes the request on to the routes after it, so one registered
// first at '/' hides nothing. A refused path is passed on just as a missing file is, so neither
// says which it was.
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";

async function show(app: Ref<Router>, method: string, path: string): Promise<void> {
  const res = await app.handle(new Request("http://h" + path, { method: method }));
  const body = await res.text();
  console.log(method === "GET" ? path : method + " " + path, res.status, body.trim());
}

async function main(): Promise<void> throws IoError {
  const dir = mkdtempSync("/tmp/fish-static-");
  writeFileSync(dir + "/a.txt", "file");
  writeFileSync(dir + "/.env", "KEY=1");
  let app = new Router();
  app.use(async (req, next) => {
    let moved = req;
    if (moved.path === "/old") moved.path = "/api";
    const res = await next(moved);
    return res;
  });
  app.static("/", dir);
  app.get("/api", async (req) => new Response("api"));
  app.get("/.env", async (req) => new Response("route .env"));
  for (const path of ["/api", "/a.txt", "/.env", "/old", "/..%2fsecret", "/missing", "/a.txt/"]) await show(app, "GET", path);
  await show(app, "HEAD", "/api");
  rmSync(dir, { recursive: true });
}
