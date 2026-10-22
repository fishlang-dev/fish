// expect: echoed 50
// expect: closed 0
// A server echoing each connection on its own task, and 50 clients at once.
async function echo(conn: TcpStream): Promise<void> {
  try {
    while (true) {
      const got = await conn.read(64);
      if (got.length === 0) return;
      await conn.write(got);
    }
  } catch (e) {
    console.log("echo failed:", e.message);
  }
}

async function serve(listener: TcpListener, n: i64): Promise<void> throws IoError {
  for (let i = 0; i < n; i++) {
    const conn = await listener.accept();
    spawn(echo(conn));
  }
}

async function client(port: i64, i: i64): Promise<i64> throws IoError {
  const conn = await TcpStream.connect("127.0.0.1", port);
  const sent = `hello from client ${i}, ünïcødé 🐟`;
  const bytes = new TextEncoder().encode(sent);
  const size = bytes.length;
  await conn.write(bytes);
  // Small reads split characters across them, so the bytes are gathered before decoding.
  let all: u8[] = [];
  while (all.length < size) {
    const got = await conn.read(7);
    if (got.length === 0) return 0;
    for (const b of got) all.push(b);
  }
  return new TextDecoder().decode(all) === sent ? 1 : 0;
}

async function check(port: i64, i: i64): Promise<i64> {
  try {
    const ok = await client(port, i);
    return ok;
  } catch (e) {
    console.log("client failed:", e.message);
    return 0;
  }
}

async function closing(listener: TcpListener): Promise<void> throws IoError {
  const conn = await listener.accept();
}

async function main(): Promise<void> throws IoError {
  const listener = await TcpListener.bind("127.0.0.1", 0);
  const port = listener.port;
  const server = spawn(serve(listener, 50));
  let handles: JoinHandle<i64>[] = [];
  for (let i = 0; i < 50; i++) handles.push(spawn(check(port, i)));
  let echoed: i64 = 0;
  while (handles.length > 0) {
    const h = handles.pop()!;
    const one = await h;
    echoed += one;
  }
  await server;
  console.log("echoed", echoed);
  // A server that accepts and at once drops the connection: the client reads the end.
  const other = await TcpListener.bind("127.0.0.1", 0);
  const otherPort = other.port;
  const done = spawn(closing(other));
  const conn = await TcpStream.connect("127.0.0.1", otherPort);
  await done;
  const end = await conn.read(16);
  console.log("closed", end.length);
}
