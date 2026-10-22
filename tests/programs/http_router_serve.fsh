// expect: HTTP/1.1 200 OK|user 7
// expect: HTTP/1.1 201 Created|made alice
// expect: HTTP/1.1 404 Not Found|Not Found
// expect: served 50
// A Router handed to serve answers routed requests from raw clients and 404s the rest.
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

function line(text: string): string {
  const parts = text.split("\r\n\r\n");
  return parts[0].split("\r\n")[0] + "|" + parts[1].trim();
}

async function many(port: i64, i: i64): Promise<i64> {
  try {
    const text = await ask(port, "GET /users/" + String(i) + " HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n");
    return text.endsWith("user " + String(i)) ? 1 : 0;
  } catch (e) {
    return 0;
  }
}

async function main(): Promise<void> throws IoError {
  let app = new Router();
  app.get("/users/:id", async (req) => new Response("user " + req.param("id")));
  app.post("/users", async (req) => {
    const name = await req.text();
    return new Response("made " + name, { status: 201 });
  });
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info) => { seen.port.store(info.port); } }, app.handler()));
  while (found.port.load() === 0) await sleep(1);
  const port = found.port.load();
  const a = await ask(port, "GET /users/7 HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n");
  console.log(line(a));
  const b = await ask(port, "POST /users HTTP/1.1\r\nHost: h\r\nContent-Length: 5\r\nConnection: close\r\n\r\nalice");
  console.log(line(b));
  const c = await ask(port, "GET /nowhere HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n");
  console.log(line(c));
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
