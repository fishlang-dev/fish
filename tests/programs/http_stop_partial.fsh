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
  await conn.write(new TextEncoder().encode("POST / HTTP/1.1\r\nHost: h\r\nContent-Length: 100\r\n\r\nabc"));
  await sleep(50);
  ctl.abort();
  await server;
  console.log("serve returned");
  const got = await conn.read(64);
  if (got.length === 0) console.log("client closed");
}
