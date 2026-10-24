// case: tcp_abort
// expect: accept: This operation was aborted
// expect: read: This operation was aborted
// expect: read later: This operation was aborted
// expect: wrote 3
// expect: io: can't connect: Connection refused
// Socket waits given an AbortSignal throw AbortError, or IoError for the system's reasons.
async function main(): Promise<void> throws IoError | AbortError {
  const listener = await TcpListener.bind("127.0.0.1", 0);
  try {
    const conn = await listener.accept(AbortSignal.timeout(50));
    console.log("accepted");
  } catch (e) {
    if (e instanceof AbortError) console.log("accept:", e.message);
    else console.log("io:", e.message);
  }
  const port = listener.port;
  const c = await TcpStream.connect("127.0.0.1", port, AbortSignal.timeout(1000));
  const server = await listener.accept();
  const ctl = new AbortController();
  ctl.abort();
  try {
    const got = await c.read(10, ctl.signal);
  } catch (e) {
    if (e instanceof AbortError) console.log("read:", e.message);
    else console.log("io:", e.message);
  }
  try {
    const got = await c.read(10, AbortSignal.timeout(30));
  } catch (e) {
    if (e instanceof AbortError) console.log("read later:", e.message);
    else console.log("io:", e.message);
  }
  let bytes: u8[] = [1, 2, 3];
  await c.write(bytes, AbortSignal.timeout(1000));
  const got = await server.read(10);
  console.log("wrote", got.length);
  let free: i64 = 0;
  {
    const closed = await TcpListener.bind("127.0.0.1", 0);
    free = closed.port;
  }
  try {
    const refused = await TcpStream.connect("127.0.0.1", free, AbortSignal.timeout(1000));
  } catch (e) {
    if (e instanceof AbortError) console.log("aborted:", e.message);
    else console.log("io:", e.message);
  }
}
// case: tcp_accept
// expect: accepted 50 50
// expect: refused true
async function serve(listener: TcpListener, n: i64): Promise<i64> throws IoError {
  let count = 0;
  for (let i = 0; i < n; i++) {
    const conn = await listener.accept();
    count++;
  }
  return count;
}

async function dial(port: i64): Promise<i64> {
  try {
    const conn = await TcpStream.connect("127.0.0.1", port);
    return 1;
  } catch (e) {
    return 0;
  }
}

async function main(): Promise<void> throws IoError {
  const listener = await TcpListener.bind("127.0.0.1", 0);
  const port = listener.port;
  const server = spawn(serve(listener, 50));
  let handles: JoinHandle<i64>[] = [];
  for (let i = 0; i < 50; i++) handles.push(spawn(dial(port)));
  let clients: i64 = 0;
  while (handles.length > 0) {
    const h = handles.pop()!;
    const one = await h;
    clients += one;
  }
  const accepted = await server;
  console.log("accepted", accepted, clients);
  // A port nothing listens on any more: bound, then closed as the block ends.
  let free: i64 = 0;
  {
    const closed = await TcpListener.bind("127.0.0.1", 0);
    free = closed.port;
  }
  try {
    const conn = await TcpStream.connect("127.0.0.1", free);
    console.log("refused", false);
  } catch (e) {
    console.log("refused", e.message.startsWith("can't connect"));
  }
}
// case: tcp_big_write
// expect: true
// A write larger than the socket holds waits for room, and all of it arrives.
async function sink(listener: TcpListener, size: i64): Promise<i64> throws IoError {
  const conn = await listener.accept();
  let total: i64 = 0;
  let sum: i64 = 0;
  while (total < size) {
    const got = await conn.read(100000);
    if (got.length === 0) return -1;
    for (const b of got) sum += b as i64;
    total += got.length as i64;
  }
  return sum;
}
async function main(): Promise<void> throws IoError {
  const listener = await TcpListener.bind("127.0.0.1", 0);
  const size: i64 = 4000000;
  const h = spawn(sink(listener.clone(), size));
  const conn = await TcpStream.connect("127.0.0.1", listener.port);
  let bytes: u8[] = [];
  let want: i64 = 0;
  for (let i = 0; i < size; i++) { const v = (i % 251) as u8; bytes.push(v); want += i % 251; }
  await conn.write(bytes);
  const sum = await h;
  console.log(sum === want);
}
// case: tcp_broken_pipe
// expect: write failed true
// expect: still running
// Writing to a peer that has gone throws an IoError rather than ending the program.
async function main(): Promise<void> throws IoError {
  const listener = await TcpListener.bind("127.0.0.1", 0);
  const conn = await TcpStream.connect("127.0.0.1", listener.port);
  {
    const server = await listener.accept();
  }
  await sleep(20);
  try {
    for (let i = 0; i < 100; i++) {
      let b: u8[] = [];
      for (let j = 0; j < 100000; j++) b.push(7);
      await conn.write(b);
    }
    console.log("wrote all");
  } catch (e) {
    console.log("write failed", e.message.startsWith("can't write"));
  }
  try {
    const got = await conn.read(10);
  } catch (e) {
  }
  console.log("still running");
}
// case: tcp_duplex
// expect: 4000000 true
// One task reads a socket while another writes it, through a clone of the stream.
async function echo(listener: TcpListener): Promise<void> throws IoError {
  const conn = await listener.accept();
  while (true) {
    const got = await conn.read(65536);
    if (got.length === 0) return;
    await conn.write(got);
  }
}
async function writer(conn: TcpStream, size: i64): Promise<void> throws IoError {
  let bytes: u8[] = [];
  for (let i = 0; i < size; i++) bytes.push((i % 251) as u8);
  await conn.write(bytes);
}
async function main(): Promise<void> throws IoError {
  const listener = await TcpListener.bind("127.0.0.1", 0);
  const size: i64 = 4000000;
  const e = spawn(echo(listener.clone()));
  const conn = await TcpStream.connect("127.0.0.1", listener.port);
  const w = spawn(writer(conn.clone(), size));
  let total: i64 = 0;
  let ok = true;
  while (total < size) {
    const got = await conn.read(65536);
    if (got.length === 0) break;
    for (const b of got) { if ((b as i64) !== (total % 251)) ok = false; total++; }
  }
  await w;
  console.log(total, ok);
}
// case: tcp_echo
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
// case: tcp_errors
// expect: 'nowhere' is not an IPv4 address like 127.0.0.1; host names aren't looked up
// expect: can't listen there: Address already in use
// expect: port 70000 is outside 0 to 65535
async function main(): Promise<void> throws IoError {
  try {
    const l = await TcpListener.bind("nowhere", 0);
    console.log("bound");
  } catch (e) {
    console.log(e.message);
  }
  const first = await TcpListener.bind("127.0.0.1", 0);
  try {
    const again = await TcpListener.bind("127.0.0.1", first.port);
    console.log("bound twice");
  } catch (e) {
    console.log(e.message);
  }
  try {
    const c = await TcpStream.connect("127.0.0.1", 70000);
  } catch (e) {
    console.log(e.message);
  }
}
// case: tcp_read_zero
// expect: 'read' needs room for at least 1 byte, not 0
async function main(): Promise<void> throws IoError {
  const listener = await TcpListener.bind("127.0.0.1", 0);
  const conn = await TcpStream.connect("127.0.0.1", listener.port);
  try {
    const got = await conn.read(0);
  } catch (e) {
    console.log(e.message);
  }
}
// case: tcp_shared_listener
// expect: 20
// Two tasks accepting on one listener, cloned: each is woken in turn.
async function serve(listener: TcpListener, n: i64): Promise<i64> throws IoError {
  for (let i = 0; i < n; i++) {
    const conn = await listener.accept();
  }
  return n;
}
async function main(): Promise<void> throws IoError {
  const listener = await TcpListener.bind("127.0.0.1", 0);
  const port = listener.port;
  const a = spawn(serve(listener.clone(), 10));
  const b = spawn(serve(listener, 10));
  for (let i = 0; i < 20; i++) {
    const c = await TcpStream.connect("127.0.0.1", port);
  }
  const x = await a;
  const y = await b;
  console.log(x + y);
}
// case: tcp_shutdown
// expect: main done
// Tasks still waiting on sockets when main ends are dropped with them, leaking nothing.
async function reader(listener: TcpListener): Promise<void> throws IoError {
  const conn = await listener.accept();
  const got = await conn.read(10);
  console.log("never", got.length);
}

async function acceptor(listener: TcpListener): Promise<void> throws IoError {
  const conn = await listener.accept();
  console.log("never");
}

async function hold(conn: TcpStream): Promise<void> {
  await sleep(100000);
}

async function main(): Promise<void> throws IoError {
  const first = await TcpListener.bind("127.0.0.1", 0);
  const port = first.port;
  const second = await TcpListener.bind("127.0.0.1", 0);
  spawn(reader(first));
  spawn(acceptor(second));
  const conn = await TcpStream.connect("127.0.0.1", port);
  spawn(hold(conn));
  await sleep(20);
  console.log("main done");
}
// case: tcp_sync_main
// error: 'TcpListener.bind' works only when 'main' is an async function, whose runtime waits on sockets
function main() {
  const l = TcpListener.bind("127.0.0.1", 0);
}
// case: tcp_write_string
// error: 'write' takes the bytes to send as a 'u8[]', like 'new TextEncoder().encode(text)', not '"hello"'
async function main(): Promise<void> throws IoError {
  const listener = await TcpListener.bind("127.0.0.1", 0);
  const conn = await TcpStream.connect("127.0.0.1", listener.port);
  await conn.write("hello");
}
