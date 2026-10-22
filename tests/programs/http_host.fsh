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
