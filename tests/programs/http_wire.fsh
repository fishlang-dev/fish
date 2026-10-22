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
