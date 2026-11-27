// A Fish WebSocket server driven by a client written here from RFC 6455,
// apart from std's own WebSocket code, so the server meets bytes its code didn't make: one that
// answers pings and closes as a browser's does, and a raw one for the frames a well-behaved client
// never sends. The server runs under `sh`, which starts a driver, a Fish program built beside it, in
// the background and then execs the server, so the test sees the server's own exit code. The
// driver, given the server's pid and the file its stderr goes to, waits for its port, acts as its
// clients, stops it with SIGTERM, and writes what it saw to a file once done: one fact per line, a
// name, a tab and a JSON string.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { built, removed, root, same, scratch, text } from "./support.fsh";

function server(): string {
  return `import { readFileSync } from "node:fs";

async function later(sender: WebSocketSender): Promise<void> {
  await sleep(20);
  sender.send("from another task");
}

async function main(): Promise<void> throws IoError {
  let app = new Router();
  app.ws("/echo", async (ws, _req) => {
    for await (const m of ws) ws.send(m);
  });
  app.ws("/room/:name", async (ws, req) => {
    ws.send("hi " + req.param("name"));
    for await (const m of ws) ws.send(m);
  });
  app.ws("/push", async (ws, _req) => {
    spawn(later(ws.sender()));
    for await (const m of ws) ws.send(m);
  });
  app.ws("/close", async (ws, _req) => {
    ws.close(4000, "bye");
    ws.send("dropped");
    for await (const m of ws) ws.send(m);
  });
  app.ws("/return", async (ws, _req) => {
    ws.send("one");
    await ws.flush();
  });
  app.ws("/panic", async (ws, _req) => {
    for await (const m of ws) {
      assert(m !== "boom", "the handler gave up");
    }
  });
  app.ws("/badclose", async (ws, _req) => {
    ws.close(1006);
  });
  app.ws("/small", async (ws, _req) => {
    for await (const m of ws) {
      if (m === "flood") ws.send("x".repeat(2000));
      else ws.send(m);
    }
  }, { maxMessageSize: 10, maxBuffered: 1000, idleTimeout: 300 });
  let secret = new Router();
  secret.use(async (req: Request, next: (req: Request) => Promise<Response>) => {
    if (req.headers.get("x-token") !== "let me in") return new Response("no\\n", { status: 401 });
    const res = await next(req);
    return res;
  });
  secret.ws("/", async (ws, _req) => {
    ws.send("inside");
    for await (const m of ws) ws.send(m);
  });
  app.route("/secret", secret);
  const dir = process.argv[2];
  const listen = (info: ServeInfo) => { console.error("listening " + String(info.port)); };
  if (dir.length > 0) {
    const keys = { cert: readFileSync(dir + "/server.pem", "utf8"), key: readFileSync(dir + "/server-key.pem", "utf8") };
    await serve({ port: 0, hostname: "127.0.0.1", tls: keys, onListen: listen }, app.handler());
  } else await serve({ port: 0, hostname: "127.0.0.1", onListen: listen }, app.handler());
  console.error("stopped");
}
`;
}

// What every driver starts with: the server's port once it says where it listens, stopping it, the
// clients, and writing the facts once its own `drive()` ends, or the error that stopped it, which
// kills the server.
function prelude(): string {
  return String.raw`import { readFileSync, renameSync, writeFileSync } from "node:fs";

type Facts = Map<string, string>;

function pid(): i64 {
  return parseInt(process.argv[2]) ?? 0;
}

function stderr(): string {
  try {
    return readFileSync(process.argv[3], "utf8");
  } catch (_e) {
    return "";
  }
}

function alive(): boolean {
  try {
    return process.kill(pid(), 0);
  } catch (_e) {
    return false;
  }
}

async function listening(): Promise<i64> throws Error {
  const deadline = Date.now() + 10000;
  while (true) {
    const text = await spawnBlocking(() => stderr());
    let lines = text.split("\n");
    lines.pop();
    for (const l of lines) {
      if (!l.startsWith("listening ")) continue;
      const p = parseInt(l.slice(10));
      if (p !== null) return p!;
    }
    if (!alive()) throw new Error("the server ended: " + text);
    if (Date.now() > deadline) throw new Error("the server never listened: " + text);
    await sleep(10);
  }
}

async function stop(): Promise<void> throws Error | IoError {
  process.kill(pid(), "SIGTERM");
  const deadline = Date.now() + 10000;
  while (alive()) {
    if (Date.now() > deadline) {
      process.kill(pid(), "SIGKILL");
      throw new Error("the server hung at SIGTERM");
    }
    await sleep(10);
  }
}

function utf8(s: string): u8[] {
  return new TextEncoder().encode(s);
}

function decoded(bytes: Ref<u8[]>): string {
  return new TextDecoder().decode(bytes);
}

function zeros(n: usize): u8[] {
  return new Array<u8>(n).fill(0);
}

type Frame = { fin: boolean; opcode: i64; payload: u8[] };

// One connection: what has been read and not yet taken, from at on, whether the connection has
// ended, the handshake's response head, and, as a browser's client sees them, the messages and the
// close in the order they came, as JSON, the messages not yet taken, and the close once it came.
class Socket {
  sock: TcpStream;
  buf: u8[];
  at: i64;
  over: boolean;
  head: string;
  events: string[];
  pending: Frame[];
  partial: u8[];
  partialOpcode: i64;
  shut: boolean;
  closeCode: i64;
  constructor(sock: TcpStream) {
    this.sock = sock;
    this.buf = [];
    this.at = 0;
    this.over = false;
    this.head = "";
    this.events = [];
    this.pending = [];
    this.partial = [];
    this.partialOpcode = 0;
    this.shut = false;
    this.closeCode = 0;
  }
}

function left(c: Ref<Socket>): i64 {
  return (c.buf.length as i64) - c.at;
}

function byte(c: Ref<Socket>, k: i64): i64 {
  return c.buf[(c.at + k) as usize] as i64;
}

// One read into the buffer, waiting until deadline at most; a connection that ends or fails is over.
async function fill(c: Mut<Socket>, deadline: i64): Promise<void> {
  const wait = deadline - Date.now();
  if (c.over || wait <= 0) return;
  try {
    const more = await c.sock.read(65536, AbortSignal.timeout(wait));
    if (more.length === 0) c.over = true;
    for (const b of more) c.buf.push(b);
  } catch (e) {
    if (!(e instanceof AbortError)) c.over = true;
  }
}

const KEY = "dGhlIHNhbXBsZSBub25jZQ==";

// Sends the request and reads the response's head, leaving what follows it in the buffer.
async function handshake(sock: TcpStream, request: string): Promise<Socket> throws Error | IoError | AbortError {
  let c = new Socket(sock);
  await c.sock.write(utf8(request));
  const deadline = Date.now() + 5000;
  while (true) {
    for (let i: i64 = 0; i + 3 < (c.buf.length as i64); i++) {
      if (byte(c, i) === 13 && byte(c, i + 1) === 10 && byte(c, i + 2) === 13 && byte(c, i + 3) === 10) {
        c.head = decoded(c.buf.slice(0, i));
        c.at = i + 4;
        return c;
      }
    }
    if (c.over) throw new Error("the connection ended before the handshake's response");
    if (Date.now() >= deadline) throw new Error("timed out reading from the server");
    await fill(c, deadline);
  }
  return c;
}

// A raw client that has sent its upgrade request, by requestLine when it isn't empty.
async function rawClient(port: i64, path: string, extra: string = "", requestLine: string = ""): Promise<Socket> throws Error | IoError | AbortError {
  const sock = await TcpStream.connect("127.0.0.1", port);
  const first = requestLine.length > 0 ? requestLine : "GET " + path + " HTTP/1.1";
  const c = await handshake(sock, first + "\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " + KEY + "\r\nSec-WebSocket-Version: 13\r\n" + extra + "\r\n");
  return c;
}

// A client upgraded as a browser's is, over sock, failing unless the server agreed.
async function opened(sock: TcpStream, host: string, path: string, headers: string): Promise<Socket> throws Error | IoError | AbortError {
  const c = await handshake(sock, "GET " + path + " HTTP/1.1\r\nHost: " + host + "\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: " + KEY + "\r\n" + headers + "\r\n");
  if (!c.head.startsWith("HTTP/1.1 101 ")) throw new Error("couldn't open " + path + ": " + c.head);
  return c;
}

async function client(port: i64, path: string, headers: string = ""): Promise<Socket> throws Error | IoError | AbortError {
  const sock = await TcpStream.connect("127.0.0.1", port);
  const c = await opened(sock, "127.0.0.1:" + String(port), path, headers);
  return c;
}

// The frame at the front of the buffer, taken from it once all of it has arrived.
function parsed(c: Mut<Socket>): Frame | null {
  const have = left(c);
  if (have < 2) return null;
  let length = byte(c, 1) & 127;
  let at: i64 = 2;
  if (length === 126) {
    if (have < 4) return null;
    length = (byte(c, 2) << 8) | byte(c, 3);
    at = 4;
  } else if (length === 127) {
    if (have < 10) return null;
    length = 0;
    for (let k: i64 = 2; k < 10; k++) length = length * 256 + byte(c, k);
    at = 10;
  }
  if (have < at + length) return null;
  const first = byte(c, 0);
  const start = (c.at + at) as usize;
  const payload = c.buf.slice(start as i64, (start as i64) + length);
  c.at += at + length;
  if (c.at > 65536) {
    c.buf = c.buf.slice(c.at);
    c.at = 0;
  }
  return { fin: (first & 128) !== 0, opcode: first & 15, payload: payload };
}

// The next frame, or null once the connection has ended.
async function frame(c: Mut<Socket>): Promise<Frame | null> throws Error {
  const deadline = Date.now() + 5000;
  while (true) {
    const f = parsed(c);
    if (f !== null) return f;
    if (c.over) return null;
    if (Date.now() >= deadline) throw new Error("timed out reading from the server");
    await fill(c, deadline);
  }
  return null;
}

// Sends a frame masked with the key 1, 2, 3, 4 unless mask is false. claim writes the length in the
// 8-byte form, which may say more than the payload holds. A write the server no longer takes is
// dropped, as a socket's error is.
async function send(c: Ref<Socket>, opcode: i64, payload: u8[], fin: boolean = true, mask: boolean = true, claim: u64 | null = null): Promise<void> {
  let out: u8[] = [((fin ? 128 : 0) | opcode) as u8];
  const bit = mask ? 128 : 0;
  const n = payload.length as i64;
  if (claim !== null) {
    out.push((127 | bit) as u8);
    for (let k: u64 = 0; k < 8; k++) out.push(((claim! >> (56 - 8 * k)) & 255) as u8);
  } else if (n < 126) {
    out.push((n | bit) as u8);
  } else if (n < 65536) {
    out.push((126 | bit) as u8);
    out.push((n >> 8) as u8);
    out.push((n & 255) as u8);
  } else {
    out.push((127 | bit) as u8);
    for (let k: i64 = 0; k < 8; k++) out.push(((n >> (56 - 8 * k)) & 255) as u8);
  }
  const key: u8[] = [1, 2, 3, 4];
  if (mask) for (const b of key) out.push(b);
  for (let i: usize = 0; i < payload.length; i++) out.push(mask ? payload[i] ^ key[i & 3] : payload[i]);
  try {
    await c.sock.write(out, AbortSignal.timeout(5000));
  } catch (_e) {}
}

function shown(f: Ref<Frame>): string {
  if (f.opcode !== 8 || f.payload.length < 2) return decoded(f.payload);
  const code = ((f.payload[0] as i64) << 8) | (f.payload[1] as i64);
  return String(code) + " " + decoded(f.payload.slice(2));
}

// The server's frames up to and including its close, each as JSON's [opcode, text].
async function frames(c: Mut<Socket>): Promise<string[]> throws Error {
  let seen: string[] = [];
  while (true) {
    const f = await frame(c);
    if (f === null) break;
    seen.push("[" + String(f.opcode) + "," + JSON.stringify(shown(f)) + "]");
    if (f.opcode === 8) break;
  }
  return seen;
}

async function rest(c: Mut<Socket>): Promise<string> throws Error {
  const seen = await frames(c);
  return "[" + seen.join(",") + "]";
}

async function ended(c: Mut<Socket>): Promise<void> throws Error {
  const deadline = Date.now() + 5000;
  while (!c.over) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for the server to end the connection");
    await fill(c, deadline);
  }
}

function closedWith(c: Mut<Socket>, code: i64, reason: string): void {
  c.events.push("[\"close\"," + String(code) + "," + JSON.stringify(reason) + "]");
  c.closeCode = code;
  c.shut = true;
}

// What a browser's client does with a frame: a ping gets its pong, a close is echoed, and a whole
// message is kept.
async function handled(c: Mut<Socket>, f: Frame): Promise<void> {
  if (f.opcode === 9) await send(c, 10, f.payload.slice());
  else if (f.opcode === 8) {
    await send(c, 8, f.payload.slice(0, 2));
    if (f.payload.length < 2) closedWith(c, 1005, "");
    else closedWith(c, ((f.payload[0] as i64) << 8) | (f.payload[1] as i64), decoded(f.payload.slice(2)));
  } else if (f.opcode === 1 || f.opcode === 2 || f.opcode === 0) {
    if (f.opcode !== 0) c.partialOpcode = f.opcode;
    for (const b of f.payload) c.partial.push(b);
    if (!f.fin) return;
    const payload = c.partial.slice();
    c.partial = [];
    c.events.push(c.partialOpcode === 1 ? JSON.stringify(decoded(payload)) : "[" + payload.map((b: u8) => String(b)).join(",") + "]");
    c.pending.push({ fin: true, opcode: c.partialOpcode, payload: payload });
  }
}

// The next message's text, answering what comes before it.
async function received(c: Mut<Socket>): Promise<string> throws Error {
  while (c.pending.length === 0) {
    if (c.shut) throw new Error("the connection closed before a message came");
    const f = await frame(c);
    if (f === null) closedWith(c, 1006, "");
    else await handled(c, f);
  }
  const m = c.pending.shift()!;
  return decoded(m.payload);
}

// Every message and the close, as JSON, once the connection has closed.
async function closed(c: Mut<Socket>): Promise<string> throws Error {
  while (!c.shut) {
    const f = await frame(c);
    if (f === null) closedWith(c, 1006, "");
    else await handled(c, f);
  }
  return "[" + c.events.join(",") + "]";
}

// Starts the closing handshake with code and reason, then reads until the server's close.
async function close(c: Mut<Socket>, code: i64 = 1000, reason: string = ""): Promise<string> throws Error {
  let payload: u8[] = [(code >> 8) as u8, (code & 255) as u8];
  for (const b of utf8(reason)) payload.push(b);
  await send(c, 8, payload);
  const all = await closed(c);
  return all;
}

// What a browser's client spends ms doing while its program waits: answering pings.
async function idle(c: Mut<Socket>, ms: i64): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && !c.over) {
    const f = parsed(c);
    if (f !== null) await handled(c, f);
    else await fill(c, deadline);
  }
}

async function main(): Promise<void> {
  let facts: Facts = new Map<string, string>();
  try {
    await drive(facts);
  } catch (e) {
    facts.set("error", e.message);
    try {
      process.kill(pid(), "SIGKILL");
    } catch (_e) {}
  }
  let out: string[] = [];
  for (const [k, v] of facts) out.push(k + "\t" + JSON.stringify(v));
  const done = process.argv[4];
  try {
    writeFileSync(done + ".part", out.join("\n"));
    renameSync(done + ".part", done);
  } catch (_e) {}
}
`;
}

// What a server's run gave: its exit code or the signal that ended it, its stderr, and the
// driver's facts.
type Run = { code: i64 | null; signal: string | null; stderr: string; facts: string };

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    assert(false, `can't read ${path}: ${e.message}`);
    return "";
  }
}

// Builds the server and runs it with FISH_LEAKS set, serving TLS from `tlsDir` when it isn't empty,
// driven by `driver`, the body of an async `drive()` with the top-level declarations in `helpers`
// beside it. Its stderr must report no leaks.
function run(driver: string, tlsDir: string, helpers: string = ""): Run {
  const tmp = scratch("fish-websocket-");
  const binary = built(tmp, "server", server());
  const err = join(tmp, "stderr");
  const done = join(tmp, "facts");
  const drv = built(tmp, "drive", `${prelude()}\n${helpers}\nasync function drive(facts: Mut<Facts>): Promise<void> throws Error | IoError | AbortError | TypeError {\nconst port = await listening();\n${driver}\n}\n`);
  const script = `"$3" $$ "$1" "$4" > /dev/null 2>&1 &
exec env FISH_LEAKS=1 "$2" "$5" 2> "$1"`;
  const ran = spawnSync("sh", ["-c", script, "sh", err, binary, drv, done, tlsDir]);
  // The driver writes its facts once it is done, which may be just after the server exits.
  spawnSync("sh", ["-c", `n=0; while [ ! -e "$1" ] && [ $n -lt 100 ]; do sleep 0.05; n=$((n + 1)); done`, "sh", done]);
  const stderr = existsSync(err) ? readText(err) : "";
  assert(!stderr.includes("fish: leaked"), `the server leaked:\n${stderr}`);
  const facts = existsSync(done) ? readText(done) : "error\t\"the driver never finished\"";
  removed(tmp);
  return { code: ran.status, signal: ran.signal, stderr, facts };
}

// The driver's fact `name`, failing the test when the driver stopped with an error.
function fact(r: Ref<Run>, name: string): string {
  let found = "";
  for (const l of r.facts.split("\n")) {
    const tab = l.indexOf("\t");
    if (tab < 0) continue;
    const key = l.slice(0, tab as i64);
    let value = "";
    try {
      value = JSON.parse<string>(l.slice((tab + 1) as i64));
    } catch (e) {
      assert(false, `an unreadable fact: ${l}`);
    }
    assert(key !== "error", `the driver failed: ${value}\nthe server's stderr:\n${r.stderr}`);
    if (key === name) found = value;
  }
  return found;
}

function exitedWith(r: Ref<Run>, code: i64): void {
  same(`${JSON.stringify(r.code)} ${JSON.stringify(r.signal)}`, `${code} null`, `the server's exit code and signal (stderr: ${r.stderr})`);
}

test("text, binary and large messages echo, and the client's close is answered", () => {
  const r = run(String.raw`let c = await client(port, "/echo");
await send(c, 1, utf8("hello"));
await send(c, 2, [1, 2, 255]);
await send(c, 1, utf8("é".repeat(40000)));
const _hello = await received(c);
const _bytes = await received(c);
const large = await received(c);
const _all = await close(c, 1000, "done");
facts.set("first", "[" + c.events.slice(0, 2).join(",") + "]");
facts.set("large", large);
// A close whose payload holds a code also holds a reason, though it may be empty.
facts.set("close", "[\"close\"," + String(c.closeCode) + "," + (c.closeCode === 1005 || c.closeCode === 1006 ? "\"none\"" : "\"string\"") + "]");
await stop();`, "");
  same(fact(r, "first"), `["hello",[1,2,255]]`, "the first two echoes");
  same(fact(r, "large"), "é".repeat(40000), "the large echo");
  same(fact(r, "close"), `["close",1000,"string"]`, "the close, with a string reason");
  exitedWith(r, 0);
}, { timeout: 60_000 });

test("path params, mounted routers and their middleware apply before the upgrade", () => {
  const r = run(String.raw`let room = await client(port, "/room/a%20b");
const greeting = await received(room);
facts.set("room", greeting);
const _room = await close(room);
// Middleware refusing the request answers it as it would any other.
const refused = await rawClient(port, "/secret");
facts.set("refused", refused.head);
let inside = await client(port, "/secret", "x-token: let me in\r\n");
const within = await received(inside);
facts.set("inside", within);
const _inside = await close(inside);
// A plain GET, a wrong version, a bad key, a HEAD and HTTP/1.0 are refused without upgrading.
const plain = await fetch("http://127.0.0.1:" + String(port) + "/echo");
facts.set("plain", "[" + String(plain.status) + "," + JSON.stringify(plain.headers.get("upgrade") ?? "(none)") + "]");
const _plain = await plain.text();
const version = await answered(port, "upgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-version: 8\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\n", "sec-websocket-version");
facts.set("version", version);
const key = await answered(port, "upgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-version: 13\r\nsec-websocket-key: short\r\n", "");
facts.set("key", key);
// RFC 6455 upgrades a GET over HTTP/1.1 only.
let heads: string[] = [];
for (const line of ["HEAD /echo HTTP/1.1", "GET /echo HTTP/1.0"]) {
  const c = await rawClient(port, "/echo", "", line);
  heads.push(c.head);
}
facts.set("head", heads[0]);
facts.set("http10", heads[1]);
await stop();`, "", String.raw`// The status of the answer to a GET of /echo with fields, and the header name's value, as JSON's
// [status, value], or the status alone when name is empty. fetch would replace the request's
// Connection field with its own.
async function answered(port: i64, fields: string, name: string): Promise<string> throws Error | IoError | AbortError {
  const sock = await TcpStream.connect("127.0.0.1", port);
  const c = await handshake(sock, "GET /echo HTTP/1.1\r\nHost: 127.0.0.1\r\n" + fields + "\r\n");
  const lines = c.head.split("\r\n");
  const status = lines[0].split(" ")[1];
  if (name.length === 0) return status;
  let value = "null";
  for (const l of lines) if (l.toLowerCase().startsWith(name + ":")) value = JSON.stringify(l.slice((name.length + 1) as i64).trim());
  return "[" + status + "," + value + "]";
}`);
  same(fact(r, "room"), "hi a b", "the room's greeting");
  assert(fact(r, "refused").startsWith("HTTP/1.1 401 Unauthorized"), `the refused upgrade's head: ${fact(r, "refused")}`);
  same(fact(r, "inside"), "inside", "the mounted router's greeting");
  same(fact(r, "plain"), `[426,"websocket"]`, "a plain GET's status and upgrade header");
  same(fact(r, "version"), `[426,"13"]`, "a wrong version's status and version header");
  same(fact(r, "key"), "400", "a bad key's status");
  assert(fact(r, "head").startsWith("HTTP/1.1 405 Method Not Allowed\r\n"), `a HEAD's head: ${fact(r, "head")}`);
  assert(fact(r, "http10").startsWith("HTTP/1.1 400 Bad Request\r\n"), `an HTTP/1.0 GET's head: ${fact(r, "http10")}`);
}, { timeout: 60_000 });

test("the handshake's accept key is RFC 6455's, and no extension or subprotocol is agreed", () => {
  const r = run(String.raw`let c = await rawClient(port, "/echo", "Sec-WebSocket-Extensions: permessage-deflate\r\nSec-WebSocket-Protocol: chat\r\n");
facts.set("head", c.head);
await send(c, 8, [3, 232]);
const after = await rest(c);
facts.set("rest", after);
await stop();`, "");
  const head = fact(r, "head");
  assert(head.startsWith("HTTP/1.1 101 Switching Protocols\r\n"), `the head: ${head}`);
  assert(head.includes("\r\nsec-websocket-accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n"), `no accept key in: ${head}`);
  assert(!head.toLowerCase().includes("sec-websocket-extensions"), `an extension agreed in: ${head}`);
  assert(!head.toLowerCase().includes("sec-websocket-protocol"), `a subprotocol agreed in: ${head}`);
  same(fact(r, "rest"), `[[8,"1000 "]]`, "the frames after the close");
}, { timeout: 60_000 });

test("fragments make one message, even splitting a character, pings get pongs between them, the 8-byte length form reads, and a close is echoed", () => {
  const r = run(String.raw`let c = await rawClient(port, "/echo");
await send(c, 1, utf8("frag"), false);
await send(c, 9, utf8("are you there"));
await send(c, 0, utf8("men"), false);
await send(c, 0, utf8("ted"), true);
await send(c, 2, [7, 8], false);
await send(c, 0, [9]);
await send(c, 2, [5, 6], true, true, 2);
await send(c, 1, [0xc3], false);
await send(c, 0, [0xa9]);
await send(c, 8, [11, 184, ...utf8("later")]);
const after = await rest(c);
facts.set("rest", after);
await stop();`, "");
  same(fact(r, "rest"), `[[10,"are you there"],[1,"fragmented"],[2,"\\u0007\\b\\t"],[2,"\\u0005\\u0006"],[1,"é"],[8,"3000 "]]`, "the server's frames");
}, { timeout: 60_000 });

// Each case: the path, what the raw client sends, and the close the server answers with.
function protocolCases(): [string, string, string][] {
  return [
    ["/echo", `await send(c, 1, utf8("plain"), true, false)`, "1002 a client's frames must be masked"],
    ["/echo", `await send(c, 1, [0xc3, 0x28])`, "1007 a text message must be UTF-8"],
    ["/echo", `await send(c, 1, [0xed, 0xa0, 0x80])`, "1007 a text message must be UTF-8"],
    ["/echo", `await send(c, 0, utf8("orphan"))`, "1002 a continuation frame with no message to continue"],
    ["/echo", `await send(c, 1, utf8("a"), false); await send(c, 1, utf8("b"))`, "1002 a new message began before the last one ended"],
    ["/echo", `await send(c, 9, utf8("x"), false)`, "1002 control frames are whole and at most 125 bytes"],
    ["/echo", `await send(c, 3, utf8("x"))`, "1002 unknown opcode"],
    ["/echo", `await send(c, 8, [3, 237])`, "1002 a close code the protocol doesn't allow"],
    ["/small", `await send(c, 2, zeros(11))`, "1009 message too big"],
    ["/small", `await send(c, 1, utf8("123456"), false); await send(c, 0, utf8("78901"))`, "1009 message too big"],
    ["/small", `await send(c, 1, utf8("flood"))`, "1013 send buffer full"],
    ["/echo", `await send(c, 1, [0xc0, 0x80])`, "1007 a text message must be UTF-8"],
    ["/echo", `await send(c, 1, [0xe0, 0x80, 0x80])`, "1007 a text message must be UTF-8"],
    ["/echo", `await send(c, 1, [0xf4, 0x90, 0x80, 0x80])`, "1007 a text message must be UTF-8"],
    ["/echo", `await send(c, 1, [0x61, 0xe2, 0x82])`, "1007 a text message must be UTF-8"],
    ["/echo", `await send(c, 8, [3, 232, 0xc0, 0x80])`, "1007 a close reason must be UTF-8"],
    ["/small", `await send(c, 2, zeros(11), true, true, 11)`, "1009 message too big"],
    ["/echo", `await send(c, 2, [], true, true, 0x8000000000000000)`, "1009 message too big"],
    // A continuation claiming the largest length a frame can, after a fragment.
    ["/echo", `await send(c, 1, utf8("a"), false); await send(c, 0, [], true, true, 0x7fffffffffffffff)`, "1009 message too big"],
  ];
}

test("protocol errors close the connection with RFC 6455's codes", () => {
  const cases = protocolCases();
  const paths = cases.map(([path, _act, _close]) => JSON.stringify(path));
  const acts = cases.map(([_path, act, _close], i) => `if (i === ${i}) {\n    ${act};\n  }`);
  const r = run(`const paths: string[] = [${paths.join(", ")}];
let lasts: string[] = [];
for (let i: usize = 0; i < paths.length; i++) {
  let c = await rawClient(port, paths[i]);
  ${acts.join(" else ")}
  const seen = await frames(c);
  lasts.push(seen.at(-1) ?? "(nothing)");
  await ended(c);
}
facts.set("lasts", lasts.join("\\n"));
// None of it stopped the server.
let after = await client(port, "/echo");
await send(after, 1, utf8("still serving"));
const echo = await received(after);
facts.set("after", echo);
const _after = await close(after);
await stop();`, "");
  const lasts = fact(r, "lasts").split("\n");
  let wrong: string[] = [];
  for (let i: usize = 0; i < cases.length; i++) {
    const want = JSON.stringify([8, cases[i][2]]);
    const got = i < lasts.length ? lasts[i] : "(nothing)";
    if (got !== want) wrong.push(`${cases[i][0]} ${cases[i][1]}: expected ${want}, got ${got}`);
  }
  assert(wrong.length === 0, `${wrong.length} cases closed otherwise:\n${wrong.join("\n")}`);
  same(fact(r, "after"), "still serving", "the echo after the protocol errors");
}, { timeout: 60_000 });

test("pongs to a client that stops reading count against maxBuffered, closing with 1013", () => {
  const r = run(String.raw`let c = await rawClient(port, "/small");
let ping: u8[] = [0x89, 125 | 128, 1, 2, 3, 4];
for (let i = 0; i < 125; i++) ping.push(7);
let batch: u8[] = [];
for (let i = 0; i < 2000; i++) for (const b of ping) batch.push(b);
// Another task writes, so that nothing is read here until the pongs have filled the buffers.
spawn(flood(c.sock.clone(), batch));
await sleep(500);
const seen = await frames(c);
facts.set("last", seen.at(-1) ?? "(nothing)");
let opcodes: string[] = [];
for (let i: usize = 0; i + 1 < seen.length; i++) {
  const opcode = seen[i].slice(1, seen[i].indexOf(",") as i64);
  if (!opcodes.includes(opcode)) opcodes.push(opcode);
}
facts.set("before", "[" + opcodes.join(",") + "]");
await stop();`, "", String.raw`async function flood(sock: TcpStream, batch: u8[]): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try {
      await sock.write(batch.slice(), AbortSignal.timeout(5000));
    } catch (_e) {
      return;
    }
    await sleep(5);
  }
}`);
  same(fact(r, "last"), `[8,"1013 send buffer full"]`, "the last frame");
  const before = fact(r, "before");
  assert(before === "[10]" || before === "[]", `frames other than pongs before the close: ${before}`);
}, { timeout: 60_000 });

test("another task sends through a sender, and sends after the close are dropped", () => {
  const r = run(String.raw`let push = await client(port, "/push");
const pushed = await received(push);
facts.set("push", pushed);
const _push = await close(push);
let closing = await rawClient(port, "/close");
const after = await rest(closing);
facts.set("rest", after);
await send(closing, 1, utf8("still read"));
await send(closing, 8, [15, 160]);
await ended(closing);
await stop();`, "");
  same(fact(r, "push"), "from another task", "the other task's message");
  same(fact(r, "rest"), `[[8,"4000 bye"]]`, "the frames up to the close");
}, { timeout: 60_000 });

test("a handler that returns closes with 1000, and one that panics with 1011, as a reserved close code does", () => {
  const r = run(String.raw`let done = await client(port, "/return");
const returned = await closed(done);
facts.set("done", returned);
let panicked = await client(port, "/panic");
await send(panicked, 1, utf8("boom"));
const gaveUp = await closed(panicked);
facts.set("panicked", gaveUp);
let reserved = await client(port, "/badclose");
const bad = await closed(reserved);
facts.set("reserved", bad);
await stop();`, "");
  same(fact(r, "done"), `["one",["close",1000,""]]`, "the returning handler's events");
  same(fact(r, "panicked"), `[["close",1011,""]]`, "the panicking handler's events");
  same(fact(r, "reserved"), `[["close",1011,""]]`, "the reserved close code's events");
  assert(r.stderr.includes("the handler gave up"), `no panic message in:\n${r.stderr}`);
  assert(r.stderr.includes("a WebSocket close code is 1000 or one of 3000 to 4999, not 1006"), `no close code panic in:\n${r.stderr}`);
}, { timeout: 60_000 });

test("a silent client is pinged after the idle timeout, then dropped", () => {
  const r = run(String.raw`let c = await rawClient(port, "/small");
const ping = await frame(c);
facts.set("ping", ping === null ? "null" : String(ping.opcode));
const next = await frame(c);
facts.set("next", next === null ? "null" : "[" + String(next.opcode) + "," + JSON.stringify(shown(next)) + "]");
// A client answering pings, as a browser's does, stays.
let kept = await client(port, "/small");
await idle(kept, 900);
await send(kept, 1, utf8("still here"));
const echo = await received(kept);
facts.set("kept", echo);
const _kept = await close(kept);
await stop();`, "");
  same(fact(r, "ping"), "9", "the first frame's opcode");
  same(fact(r, "next"), "null", "what follows the ping");
  same(fact(r, "kept"), "still here", "the answering client's echo");
}, { timeout: 60_000 });

test("stopping the server closes open WebSockets with 1001", () => {
  const r = run(String.raw`let c = await client(port, "/echo");
await stop();
const events = await closed(c);
facts.set("events", events);`, "");
  same(fact(r, "events"), `[["close",1001,""]]`, "the client's events");
  exitedWith(r, 0);
  assert(r.stderr.includes("stopped"), `serve never returned:\n${r.stderr}`);
}, { timeout: 60_000 });

test("wss: WebSockets over the server's TLS", () => {
  const fixtures = join(root(), "tests", "fixtures", "tls");
  const r = run(`const ca = await spawnBlocking(() => readFileSync(${JSON.stringify(join(fixtures, "ca.pem"))}, "utf8"));
const sock = await tls.connect("localhost", port, { ca: ca });
let c = await opened(sock, "localhost:" + String(port), "/echo", "");
await send(c, 1, utf8("secret"));
const echo = await received(c);
const _all = await close(c);
facts.set("echo", echo);
await stop();`, fixtures);
  same(fact(r, "echo"), "secret", "the echo over TLS");
}, { timeout: 60_000 });
