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
