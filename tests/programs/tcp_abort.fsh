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
