// case: unix_echo
// expect: server got ping
// expect: client got pong
// expect: clone got more
// expect: end 0
// Bytes go both ways over a socket path, a clone shares its stream, and dropping the client ends
// the server's reads.
import { mkdtempSync, rmSync } from "node:fs";

async function main(): Promise<void> throws IoError {
  const dir = mkdtempSync("/tmp/fish-unix-");
  const path = dir + "/s.sock";
  const listener: UnixListener = await UnixListener.bind(path);
  let server: UnixStream;
  {
    const c: UnixStream = await UnixStream.connect(path);
    server = await listener.accept();
    await c.write(new TextEncoder().encode("ping"));
    const ping = await server.read(10);
    console.log("server got", new TextDecoder().decode(ping));
    await server.write(new TextEncoder().encode("pong"));
    const pong = await c.read(10);
    console.log("client got", new TextDecoder().decode(pong));
    const other = c.clone();
    await other.write(new TextEncoder().encode("more"));
    const more = await server.read(10);
    console.log("clone got", new TextDecoder().decode(more));
  }
  const end = await server.read(10);
  console.log("end", end.length);
  rmSync(dir, { recursive: true });
}
// case: unix_errors
// expect: in use: EADDRINUSE listen true still there true
// expect: missing: ENOENT connect true
// expect: refused: ECONNREFUSED connect true
// expect: long: ENAMETOOLONG the socket path is 200 bytes, but the system takes at most N
// expect: empty: EINVAL the socket path is empty
// expect: nul: EINVAL a socket path can't hold a NUL byte; abstract socket names aren't supported
// expect: dropped listener leaves its file: true
// Binding over a file fails without removing it; connecting finds nothing, or a file no one
// listens on; paths the system can't take are refused before any call.
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";

async function connectTo(what: string, path: string): Promise<void> {
  try {
    const c = await UnixStream.connect(path);
    console.log(what + ": connected");
  } catch (e) {
    console.log(what + ": " + e.code, e.syscall, e.path === path);
  }
}

async function bindAt(what: string, path: string): Promise<void> {
  try {
    const l = await UnixListener.bind(path);
    console.log(what + ": bound");
  } catch (e) {
    console.log(what + ": " + e.code, e.message.replace("103", "N").replace("107", "N"));
  }
}

async function main(): Promise<void> throws IoError {
  const dir = mkdtempSync("/tmp/fish-unix-");
  const taken = dir + "/taken";
  writeFileSync(taken, "x");
  try {
    const l = await UnixListener.bind(taken);
    console.log("bound over a file");
  } catch (e) {
    console.log("in use: " + e.code, e.syscall, e.path === taken, "still there", existsSync(taken));
  }
  await connectTo("missing", dir + "/none.sock");
  const stale = dir + "/stale.sock";
  {
    const l = await UnixListener.bind(stale);
  }
  await connectTo("refused", stale);
  await bindAt("long", "/tmp/" + "x".repeat(195));
  await bindAt("empty", "");
  await bindAt("nul", "\0abstract");
  console.log("dropped listener leaves its file:", existsSync(stale));
  rmSync(dir, { recursive: true });
}
// case: unix_abort
// expect: accept: This operation was aborted
// expect: read: This operation was aborted
// expect: connect: io ENOENT
// Waits on Unix sockets take an AbortSignal, as TCP's do.
import { mkdtempSync, rmSync } from "node:fs";

async function main(): Promise<void> throws IoError | AbortError {
  const dir = mkdtempSync("/tmp/fish-unix-");
  const path = dir + "/s.sock";
  const listener = await UnixListener.bind(path);
  try {
    const conn = await listener.accept(AbortSignal.timeout(30));
  } catch (e) {
    if (e instanceof AbortError) console.log("accept:", e.message);
    else console.log("io:", e.message);
  }
  const c = await UnixStream.connect(path, AbortSignal.timeout(1000));
  const server = await listener.accept();
  try {
    const got = await c.read(10, AbortSignal.timeout(30));
  } catch (e) {
    if (e instanceof AbortError) console.log("read:", e.message);
    else console.log("io:", e.message);
  }
  try {
    const none = await UnixStream.connect(dir + "/none.sock", AbortSignal.timeout(1000));
  } catch (e) {
    if (e instanceof AbortError) console.log("connect: aborted");
    else console.log("connect: io", e.code);
  }
  rmSync(dir, { recursive: true });
}
// case: unix_no_port
// error: property 'port' does not exist on type 'UnixListener'
async function main(): Promise<void> throws IoError {
  const l = await UnixListener.bind("/tmp/x.sock");
  console.log(l.port);
}
// case: unix_bind_args
// error: 'UnixListener.bind' takes a socket path, like 'UnixListener.bind("/tmp/app.sock")'
async function main(): Promise<void> throws IoError {
  const l = await UnixListener.bind("127.0.0.1", 80);
}
// case: unix_sync_main
// error: 'UnixStream.connect' works only when 'main' is an async function
function main() {
  const c = UnixStream.connect("/tmp/x.sock");
}
// case: unix_tcp_static
// error: 'TcpListener' has no static method 'unix'; it has 'bind'
async function main(): Promise<void> throws IoError {
  const l = await TcpListener.unix("/tmp/x.sock");
}
