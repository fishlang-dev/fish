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
