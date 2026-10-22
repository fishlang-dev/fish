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
  await conn.write(new TextEncoder().encode("GET /slow HTTP/1.1\r\n\r\n"));
  const text = await readAll(conn);
  return text;
}

async function main(): Promise<void> throws IoError {
  const state = shared({ port: new Atomic(0), left: new Atomic(0) });
  const seen = state.clone();
  const watched = state.clone();
  const ctl = new AbortController();
  const server = spawn(serve({ port: 0, hostname: "127.0.0.1", signal: ctl.signal, onListen: (info: ServeInfo) => { seen.port.store(info.port); } }, async (req: Request) => {
    if (req.path === "/wait") {
      while (!req.signal.aborted) await sleep(5);
      watched.left.store(1);
      return new Response("gone");
    }
    await sleep(100);
    return new Response("slow done");
  }));
  while (state.port.load() === 0) await sleep(1);
  const port = state.port.load();

  {
    const conn = await TcpStream.connect("127.0.0.1", port);
    await conn.write(new TextEncoder().encode("GET /wait HTTP/1.1\r\n\r\n"));
    await sleep(20);
  }
  while (state.left.load() === 0) await sleep(5);
  console.log("handler saw the client leave");

  // An idle keep-alive connection, and a request still being handled when the server stops.
  const idle = await TcpStream.connect("127.0.0.1", port);
  await idle.write(new TextEncoder().encode("GET /first HTTP/1.1\r\n\r\n"));
  const first = await idle.read(4096);
  const answer = spawn(slow(port));
  await sleep(30);
  ctl.abort();
  const text = await answer;
  const lines = text.split("\r\n");
  console.log("slow response|" + lines[0] + "|" + lines[lines.length - 1]);
  const rest = await readAll(idle);
  if (rest.length === 0) console.log("idle connection closed");
  await server;
  console.log("serve returned");
}
