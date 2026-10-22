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
