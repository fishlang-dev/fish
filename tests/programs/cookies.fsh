// case: cookies_parse
// expect: 2: [a=1] [b=2]
// expect: 2: [sid=quoted value] [x=]
// expect: 3: [n=café] [bad=%E9%] [half=%4]
// expect: 1: [dup=first]
// expect: 1: [ok=yes]
// expect: 0:
// expect: 1 null true false
// expect: 0
// A Cookie header read as RFC 6265 reads one: pairs trimmed and unquoted, escapes decoded unless
// they aren't UTF-8, the first of a repeated name kept, and pairs with no name or no '=' skipped.
function show(header: string) {
  const jar = new CookieMap(header);
  let out = String(jar.size) + ":";
  jar.forEach((value: string, name: string) => { out = out + " [" + name + "=" + value + "]"; });
  console.log(out);
}

function main() {
  show("a=1; b=2");
  show("  sid = \"quoted value\" ;x=");
  show("n=caf%C3%A9; bad=%E9%; half=%4");
  show("dup=first; dup=second");
  show("=nameless; flag; ;; ok=yes");
  show("");
  const jar = new CookieMap("a=1");
  console.log(jar.get("a"), jar.get("b"), jar.has("a"), jar.has("b"));
  console.log(new CookieMap().size);
}
// case: cookies_request
// expect: 2 abc def dark
// expect: 2 first light
// expect: 0 none none
// A request's cookies come from every Cookie header it sent, read when the handler asks.
async function ask(port: i64, raw: string): Promise<string> throws IoError | AbortError {
  const conn = await TcpStream.connect("127.0.0.1", port);
  await conn.write(new TextEncoder().encode(raw));
  let all: u8[] = [];
  while (true) {
    const got = await conn.read(4096, AbortSignal.timeout(5000));
    if (got.length === 0) break;
    for (const b of got) all.push(b);
  }
  return new TextDecoder().decode(all);
}

async function main(): Promise<void> throws IoError | AbortError {
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => {
    const cookies = req.cookies;
    return new Response(String(cookies.size) + " " + (cookies.get("sid") ?? "none") + " " + (cookies.get("theme") ?? "none"));
  }));
  while (found.port.load() === 0) await sleep(1);
  const port = found.port.load();
  const one = await ask(port, "GET / HTTP/1.1\r\nHost: h\r\nCookie: sid=abc%20def; theme=dark\r\nConnection: close\r\n\r\n");
  console.log(one.split("\r\n\r\n")[1]);
  const two = await ask(port, "GET / HTTP/1.1\r\nHost: h\r\nCookie: sid=first\r\nCookie: theme=light; sid=second\r\nConnection: close\r\n\r\n");
  console.log(two.split("\r\n\r\n")[1]);
  const none = await ask(port, "GET / HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n");
  console.log(none.split("\r\n\r\n")[1]);
}
// case: cookies_set
// expect: sid=again; Path=/; SameSite=Lax
// expect: prefs=dark%20mode%3B%20lang%3Den%2C%20x%0D%0ASet-Cookie%3A%20evil%3D1%20caf%C3%A9; Domain=example.com; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Max-Age=3600; Secure; HttpOnly; Partitioned; SameSite=Strict
// expect: none=x; Path=/app; SameSite=None
// expect: a=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; SameSite=Lax
// expect: gone=; Domain=d.example; Path=/p; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; SameSite=Lax
// expect: "[b=2][prefs=dark mode; lang=en, x\r\nSet-Cookie: evil=1 café][none=x][sid=again]"
// expect: "dark mode; lang=en, x\r\nSet-Cookie: evil=1 café"
// expect: d=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax
// expect: d=; Expires=Wed, 31 Dec 1969 23:59:59 GMT; SameSite=Lax
// expect: d=; Expires=Tue, 29 Feb 2000 00:00:00 GMT; SameSite=Lax
// expect: d=; Expires=Mon, 01 Jan 1900 00:00:00 GMT; SameSite=Lax
// expect: d=; Expires=Fri, 31 Dec 9999 23:59:59 GMT; SameSite=Lax
// Set and delete keep the map and one Set-Cookie line per name, attributes in Bun's order with
// its defaults, the value percent-encoded so nothing in it ends the cookie or the header, and
// an expiry in epoch milliseconds written as an HTTP date on either side of the epoch.
function main() {
  let jar = new CookieMap("a=1; b=2");
  jar.set("sid", "abc");
  jar.set("prefs", "dark mode; lang=en, x\r\nSet-Cookie: evil=1 café", { path: "", domain: "example.com", maxAge: 3600, expires: 1445412480000, secure: true, httpOnly: true, sameSite: "strict", partitioned: true });
  jar.set("none", "x", { sameSite: "none", path: "/app" });
  jar.delete("a");
  jar.delete("gone", { path: "/p", domain: "d.example" });
  jar.set("sid", "again");
  for (const line of jar.toSetCookieHeaders()) console.log(line);
  let out = "";
  jar.forEach((value: string, name: string) => { out = out + "[" + name + "=" + value + "]"; });
  console.log(JSON.stringify(out));
  const back = new CookieMap(jar.toSetCookieHeaders()[1].split(";")[0]);
  console.log(JSON.stringify(back.get("prefs")));
  for (const ms of [0, -1, 951782400000, -2208988800000, 253402300799999]) {
    let d = new CookieMap();
    d.set("d", "", { path: "", expires: ms });
    console.log(d.toSetCookieHeaders()[0]);
  }
}
// case: cookies_response
// expect: visits 41
// expect: set-cookie: visits=42; Path=/; Expires=Wed, 21 Oct 2015 07:28:00 GMT; HttpOnly; SameSite=Lax|set-cookie: old=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; SameSite=Lax
// expect: set-cookie: visits=1; Path=/; Expires=Wed, 21 Oct 2015 07:28:00 GMT; HttpOnly; SameSite=Lax|set-cookie: old=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; SameSite=Lax
// expect: set-cookie: visits=8; Path=/; Expires=Wed, 21 Oct 2015 07:28:00 GMT; HttpOnly; SameSite=Lax|set-cookie: old=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; SameSite=Lax
// Each cookie a response sets or deletes goes out as a Set-Cookie header of its own, never folded
// with commas, from a buffered body and from a streamed one alike, and a clone keeps them.
async function ask(port: i64, raw: string): Promise<string> throws IoError | AbortError {
  const conn = await TcpStream.connect("127.0.0.1", port);
  await conn.write(new TextEncoder().encode(raw));
  let all: u8[] = [];
  while (true) {
    const got = await conn.read(4096, AbortSignal.timeout(5000));
    if (got.length === 0) break;
    for (const b of got) all.push(b);
  }
  return new TextDecoder().decode(all);
}

function cookieLines(raw: string): string {
  let out: string[] = [];
  for (const line of raw.split("\r\n\r\n")[0].split("\r\n")) if (line.startsWith("set-cookie")) out.push(line);
  return out.join("|");
}

async function* pieces(): AsyncGenerator<string> { yield "streamed"; }

async function main(): Promise<void> throws IoError | AbortError {
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => {
    const visits = req.cookies.get("visits") ?? "0";
    let res = req.path === "/stream" ? new Response(pieces()) : new Response("visits " + visits);
    res.cookies.set("visits", String((parseInt(visits) ?? 0) + 1), { httpOnly: true, expires: 1445412480000 });
    res.cookies.delete("old");
    return req.path === "/clone" ? res.clone() : res;
  }));
  while (found.port.load() === 0) await sleep(1);
  const port = found.port.load();
  const one = await ask(port, "GET / HTTP/1.1\r\nHost: h\r\nCookie: visits=41\r\nConnection: close\r\n\r\n");
  console.log(one.split("\r\n\r\n")[1]);
  console.log(cookieLines(one));
  const two = await ask(port, "GET /stream HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n");
  console.log(cookieLines(two));
  const three = await ask(port, "GET /clone HTTP/1.1\r\nHost: h\r\nCookie: visits=7\r\nConnection: close\r\n\r\n");
  console.log(cookieLines(three));
}
// case: cookies_refused
// expect: /semicolon HTTP/1.1 500 Internal Server Error false
// expect: /equals HTTP/1.1 500 Internal Server Error false
// expect: /space HTTP/1.1 500 Internal Server Error false
// expect: /crlf HTTP/1.1 500 Internal Server Error false
// expect: /empty HTTP/1.1 500 Internal Server Error false
// expect: /path HTTP/1.1 500 Internal Server Error false
// expect: /path-crlf HTTP/1.1 500 Internal Server Error false
// expect: /domain HTTP/1.1 500 Internal Server Error false
// expect: /domain-ascii HTTP/1.1 500 Internal Server Error false
// expect: /delete HTTP/1.1 500 Internal Server Error false
// expect: /fine HTTP/1.1 200 OK true
// A cookie that would break out of its header or its attribute panics in the handler that sets
// it: the client gets a bare 500 with no Set-Cookie, and the server goes on serving.
async function ask(port: i64, path: string): Promise<string> throws IoError | AbortError {
  const conn = await TcpStream.connect("127.0.0.1", port);
  await conn.write(new TextEncoder().encode("GET " + path + " HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n"));
  let all: u8[] = [];
  while (true) {
    const got = await conn.read(4096, AbortSignal.timeout(5000));
    if (got.length === 0) break;
    for (const b of got) all.push(b);
  }
  const text = new TextDecoder().decode(all);
  return path + " " + text.split("\r\n")[0] + " " + String(text.includes("set-cookie"));
}

async function main(): Promise<void> throws IoError | AbortError {
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => {
    let res = new Response("ok");
    const p = req.path;
    if (p === "/semicolon") res.cookies.set("a;b", "x");
    else if (p === "/equals") res.cookies.set("a=b", "x");
    else if (p === "/space") res.cookies.set("a b", "x");
    else if (p === "/crlf") res.cookies.set("a\r\nx-evil: 1", "x");
    else if (p === "/empty") res.cookies.set("", "x");
    else if (p === "/path") res.cookies.set("a", "x", { path: "/; Domain=evil.example" });
    else if (p === "/path-crlf") res.cookies.set("a", "x", { path: "/\r\nx-evil: 1" });
    else if (p === "/domain") res.cookies.set("a", "x", { domain: "example.com; Secure" });
    else if (p === "/domain-ascii") res.cookies.set("a", "x", { domain: "\u{E9}vil.example" });
    else if (p === "/delete") res.cookies.delete("a", { path: "/\u{0}" });
    else res.cookies.set("fine", "x");
    return res;
  }));
  while (found.port.load() === 0) await sleep(1);
  const port = found.port.load();
  for (const path of ["/semicolon", "/equals", "/space", "/crlf", "/empty", "/path", "/path-crlf", "/domain", "/domain-ascii", "/delete", "/fine"]) {
    const line = await ask(port, path);
    console.log(line);
  }
}
// case: cookies_bad_name
// panic: a cookie's name must be an HTTP token, of letters, digits and !#$%&'*+-.^_|~, so 'sid; Domain=evil.example' can't be one
// A name that isn't a token would let the program write attributes of its own.
function main() {
  let jar = new CookieMap();
  jar.set("sid; Domain=evil.example", "x");
}
// case: cookies_bad_path
// panic: cookie 'sid' can't have a path holding ';', a control character or a character outside ASCII
function main() {
  let jar = new CookieMap();
  jar.set("sid", "x", { path: "/; SameSite=None" });
}
// case: cookies_request_delete
// error: a request's cookies can't be changed, so 'RequestCookies' has no method 'delete'; delete the cookie on the response instead, as 'res.cookies.delete(...)'
// Each read of req.cookies parses the request again, so a change to it would be lost; Bun's write
// back to the response doesn't exist here, so the change is refused where it is written.
async function handle(req: Request): Promise<Response> {
  req.cookies.delete("session");
  return new Response("logged out");
}
function main() {}
// case: cookies_request_set
// error: a request's cookies can't be changed, so 'RequestCookies' has no method 'set'; set the cookie on the response instead, as 'res.cookies.set(...)'
function main() {
  const req = new Request("http://h/", { headers: new Headers() });
  let cookies = req.cookies;
  cookies.set("a", "b");
}
// case: cookies_request_own_class
// error: 'RequestCookies' has no method 'set'
// A program's own class of that name gets the plain error.
class RequestCookies { n: i64 = 0; }
function main() {
  const c = new RequestCookies();
  c.set("a", "b");
}
