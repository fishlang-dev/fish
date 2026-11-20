// A Fish WebSocket server driven by Bun's WebSocket client, and by a
// raw socket for the frames a well-behaved client never sends. The server runs under `sh`, which
// starts a Bun driver in the background and then execs the server, so the test sees the server's
// own exit code. The driver, given the server's pid and the file its stderr goes to, waits for its
// port, acts as its clients, stops it with SIGTERM, and writes what it saw to a file once done: one
// fact per line, a name, a tab and a JSON string.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

// What every driver starts with: the server's port once it says where it listens, stopping it,
// Bun's WebSocket client, the raw client, and writing the facts once its own `drive()` ends, or the
// error that stopped it, which kills the server.
function prelude(): string {
  return String.raw`const fs = require("node:fs");
const { connect } = require("node:net");
const pid = Number(process.argv[2]);
const errFile = process.argv[3];
const doneFile = process.argv[4];
const facts: Record<string, unknown> = {};
const stderr = () => { try { return fs.readFileSync(errFile, "utf8"); } catch { return ""; } };
const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function listening(): Promise<number> {
  const deadline = Date.now() + 10_000;
  while (!/listening (\d+)\n/.test(stderr())) {
    if (!alive()) throw new Error("the server ended: " + stderr());
    if (Date.now() > deadline) throw new Error("the server never listened: " + stderr());
    await Bun.sleep(10);
  }
  return Number(/listening (\d+)/.exec(stderr())![1]);
}
async function stop() {
  process.kill(pid, "SIGTERM");
  const deadline = Date.now() + 10_000;
  while (alive()) {
    if (Date.now() > deadline) {
      process.kill(pid, "SIGKILL");
      throw new Error("the server hung at SIGTERM");
    }
    await Bun.sleep(10);
  }
}

type Event = string | number[] | ["close", number, string];

function bunClient(url: string, options?: object): { ws: WebSocket; events: Event[]; opened: Promise<void>; closed: Promise<void> } {
  const ws = new WebSocket(url, options as never);
  ws.binaryType = "arraybuffer";
  const events: Event[] = [];
  const opened = new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("couldn't open " + url));
  });
  const closed = new Promise<void>((resolve) => {
    ws.onclose = (e) => {
      events.push(["close", e.code, e.reason]);
      resolve();
    };
  });
  ws.onmessage = (e) => events.push(typeof e.data === "string" ? e.data : [...new Uint8Array(e.data as ArrayBuffer)]);
  return { ws, events, opened, closed };
}

const until = async (what: string, ok: () => boolean) => {
  const deadline = Date.now() + 5_000;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for " + what);
    await Bun.sleep(5);
  }
};

type Frame = { fin: boolean; opcode: number; payload: Buffer };

async function rawClient(port: number, path: string, extra = "", requestLine = "GET " + path + " HTTP/1.1") {
  const sock = connect(port, "127.0.0.1");
  let buf = Buffer.alloc(0);
  let ended = false;
  let wake: (() => void) | undefined;
  sock.on("data", (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    wake?.();
  });
  sock.on("close", () => {
    ended = true;
    wake?.();
  });
  sock.on("error", () => {});
  await new Promise((resolve) => sock.once("connect", resolve));
  sock.write(requestLine + "\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n" + extra + "\r\n");
  const need = async (n: number) => {
    const deadline = Date.now() + 5_000;
    while (buf.length < n && !ended) {
      await Promise.race([new Promise<void>((resolve) => (wake = resolve)), Bun.sleep(100)]);
      if (Date.now() > deadline) throw new Error("timed out reading from the server");
    }
    return buf.length >= n;
  };
  while (buf.indexOf("\r\n\r\n") < 0) if (!(await need(buf.length + 1))) throw new Error("the connection ended before the handshake's response");
  const end = buf.indexOf("\r\n\r\n");
  const head = buf.subarray(0, end).toString();
  buf = buf.subarray(end + 4);
  const frame = async (): Promise<Frame | null> => {
    if (!(await need(2))) return null;
    let length = buf[1]! & 127;
    let at = 2;
    if (length === 126) {
      if (!(await need(4))) return null;
      length = buf.readUInt16BE(2);
      at = 4;
    } else if (length === 127) {
      if (!(await need(10))) return null;
      length = Number(buf.readBigUInt64BE(2));
      at = 10;
    }
    if (!(await need(at + length))) return null;
    const f = { fin: (buf[0]! & 128) !== 0, opcode: buf[0]! & 15, payload: Buffer.from(buf.subarray(at, at + length)) };
    buf = buf.subarray(at + length);
    return f;
  };
  // claim writes the length in the 8-byte form, which may say more than the payload holds.
  const send = (opcode: number, payload: Buffer | string, { fin = true, mask = true, claim = undefined as bigint | undefined } = {}) => {
    const data = Buffer.from(payload);
    const key = Buffer.from([1, 2, 3, 4]);
    const long = Buffer.alloc(9);
    long[0] = 127 | (mask ? 128 : 0);
    long.writeBigUInt64BE(claim ?? 0n, 1);
    const size = claim !== undefined ? long : data.length < 126 ? Buffer.from([data.length | (mask ? 128 : 0)]) : Buffer.from([126 | (mask ? 128 : 0), data.length >> 8, data.length & 255]);
    const body = mask ? Buffer.from(data.map((b, i) => b ^ key[i & 3]!)) : data;
    sock.write(Buffer.concat([Buffer.from([(fin ? 128 : 0) | opcode]), size, ...(mask ? [key] : []), body]));
  };
  // The server's frames up to and including its close, as [opcode, text] pairs.
  const rest = async () => {
    const seen: [number, string][] = [];
    for (let f = await frame(); f !== null; f = await frame()) {
      seen.push([f.opcode, f.opcode === 8 ? f.payload.readUInt16BE(0) + " " + f.payload.subarray(2) : f.payload.toString()]);
      if (f.opcode === 8) break;
    }
    return seen;
  };
  return { head, frame, send, rest, sock, ended: () => ended };
}

function finish() {
  fs.writeFileSync(doneFile + ".part", Object.entries(facts).map(([k, v]) => k + "\t" + JSON.stringify(String(v))).join("\n"));
  fs.renameSync(doneFile + ".part", doneFile);
}
drive().then(finish, (e) => {
  facts.error = e.message;
  try { process.kill(pid, "SIGKILL"); } catch {}
  finish();
});
`;
}

// What a server's run gave: its exit code or the signal that ended it, its stderr, and the
// driver's facts.
type Run = { code: i64 | null; signal: string | null; stderr: string; facts: string };

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    assert(false, `can't read ${path}: ${e.message}`);
    return "";
  }
}

// Builds the server and runs it with FISH_LEAKS set, serving TLS from `tlsDir` when it isn't empty,
// driven by `driver`, the body of an async `drive()`. Its stderr must report no leaks.
function run(driver: string, tlsDir: string): Run {
  const tmp = scratch("fish-websocket-");
  const binary = built(tmp, "server", server());
  const err = join(tmp, "stderr");
  const done = join(tmp, "facts");
  const drv = join(tmp, "drive.ts");
  write(drv, `${prelude()}\nasync function drive() {\nconst port = await listening();\n${driver}\n}\n`);
  const script = `bun "$3" $$ "$1" "$4" > /dev/null 2>&1 &
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
  const r = run(String.raw`const c = bunClient("ws://127.0.0.1:" + port + "/echo");
await c.opened;
c.ws.send("hello");
c.ws.send(new Uint8Array([1, 2, 255]));
c.ws.send("é".repeat(40_000));
await until("three echoes", () => c.events.length === 3);
c.ws.close(1000, "done");
await c.closed;
facts.first = JSON.stringify(c.events.slice(0, 2));
facts.large = c.events[2];
const close = c.events[3] as ["close", number, string];
facts.close = JSON.stringify([close[0], close[1], typeof close[2]]);
await stop();`, "");
  same(fact(r, "first"), `["hello",[1,2,255]]`, "the first two echoes");
  same(fact(r, "large"), "é".repeat(40000), "the large echo");
  same(fact(r, "close"), `["close",1000,"string"]`, "the close, with a string reason");
  exitedWith(r, 0);
}, { timeout: 60_000 });

test("path params, mounted routers and their middleware apply before the upgrade", () => {
  const r = run(String.raw`const room = bunClient("ws://127.0.0.1:" + port + "/room/a%20b");
await room.opened;
await until("the greeting", () => room.events.length === 1);
facts.room = room.events[0];
room.ws.close();
await room.closed;
// Middleware refusing the request answers it as it would any other.
const refused = await rawClient(port, "/secret");
facts.refused = refused.head;
refused.sock.destroy();
const inside = bunClient("ws://127.0.0.1:" + port + "/secret", { headers: { "x-token": "let me in" } });
await inside.opened;
await until("the greeting", () => inside.events.length === 1);
facts.inside = inside.events[0];
inside.ws.close();
await inside.closed;
// A plain GET, a wrong version, a bad key, a HEAD and HTTP/1.0 are refused without upgrading.
const plain = await fetch("http://127.0.0.1:" + port + "/echo");
facts.plain = JSON.stringify([plain.status, plain.headers.get("upgrade")]);
await plain.text();
const version = await fetch("http://127.0.0.1:" + port + "/echo", { headers: { upgrade: "websocket", connection: "Upgrade", "sec-websocket-version": "8", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" } });
facts.version = JSON.stringify([version.status, version.headers.get("sec-websocket-version")]);
await version.text();
const key = await fetch("http://127.0.0.1:" + port + "/echo", { headers: { upgrade: "websocket", connection: "Upgrade", "sec-websocket-version": "13", "sec-websocket-key": "short" } });
facts.key = key.status;
await key.text();
// RFC 6455 upgrades a GET over HTTP/1.1 only.
let heads = [];
for (const line of ["HEAD /echo HTTP/1.1", "GET /echo HTTP/1.0"]) {
  const c = await rawClient(port, "/echo", "", line);
  heads.push(c.head);
  c.sock.destroy();
}
facts.head = heads[0];
facts.http10 = heads[1];
await stop();`, "");
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
  const r = run(String.raw`const c = await rawClient(port, "/echo", "Sec-WebSocket-Extensions: permessage-deflate\r\nSec-WebSocket-Protocol: chat\r\n");
facts.head = c.head;
c.send(8, Buffer.from([3, 232]));
facts.rest = JSON.stringify(await c.rest());
await stop();`, "");
  const head = fact(r, "head");
  assert(head.startsWith("HTTP/1.1 101 Switching Protocols\r\n"), `the head: ${head}`);
  assert(head.includes("\r\nsec-websocket-accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n"), `no accept key in: ${head}`);
  assert(!head.toLowerCase().includes("sec-websocket-extensions"), `an extension agreed in: ${head}`);
  assert(!head.toLowerCase().includes("sec-websocket-protocol"), `a subprotocol agreed in: ${head}`);
  same(fact(r, "rest"), `[[8,"1000 "]]`, "the frames after the close");
}, { timeout: 60_000 });

test("fragments make one message, even splitting a character, pings get pongs between them, the 8-byte length form reads, and a close is echoed", () => {
  const r = run(String.raw`const c = await rawClient(port, "/echo");
c.send(1, "frag", { fin: false });
c.send(9, "are you there");
c.send(0, "men", { fin: false });
c.send(0, "ted", { fin: true });
c.send(2, Buffer.from([7, 8]), { fin: false });
c.send(0, Buffer.from([9]));
c.send(2, Buffer.from([5, 6]), { claim: 2n });
c.send(1, Buffer.from([0xc3]), { fin: false });
c.send(0, Buffer.from([0xa9]));
c.send(8, Buffer.concat([Buffer.from([11, 184]), Buffer.from("later")]));
facts.rest = JSON.stringify(await c.rest());
await stop();`, "");
  same(fact(r, "rest"), `[[10,"are you there"],[1,"fragmented"],[2,"\\u0007\\b\\t"],[2,"\\u0005\\u0006"],[1,"é"],[8,"3000 "]]`, "the server's frames");
}, { timeout: 60_000 });

// Each case: the path, what the raw client sends, and the close the server answers with.
function protocolCases(): [string, string, string][] {
  return [
    ["/echo", `c.send(1, "plain", { mask: false })`, "1002 a client's frames must be masked"],
    ["/echo", `c.send(1, Buffer.from([0xc3, 0x28]))`, "1007 a text message must be UTF-8"],
    ["/echo", `c.send(1, Buffer.from([0xed, 0xa0, 0x80]))`, "1007 a text message must be UTF-8"],
    ["/echo", `c.send(0, "orphan")`, "1002 a continuation frame with no message to continue"],
    ["/echo", `(c.send(1, "a", { fin: false }), c.send(1, "b"))`, "1002 a new message began before the last one ended"],
    ["/echo", `c.send(9, "x", { fin: false })`, "1002 control frames are whole and at most 125 bytes"],
    ["/echo", `c.send(3, "x")`, "1002 unknown opcode"],
    ["/echo", `c.send(8, Buffer.from([3, 237]))`, "1002 a close code the protocol doesn't allow"],
    ["/small", `c.send(2, Buffer.alloc(11))`, "1009 message too big"],
    ["/small", `(c.send(1, "123456", { fin: false }), c.send(0, "78901"))`, "1009 message too big"],
    ["/small", `c.send(1, "flood")`, "1013 send buffer full"],
    ["/echo", `c.send(1, Buffer.from([0xc0, 0x80]))`, "1007 a text message must be UTF-8"],
    ["/echo", `c.send(1, Buffer.from([0xe0, 0x80, 0x80]))`, "1007 a text message must be UTF-8"],
    ["/echo", `c.send(1, Buffer.from([0xf4, 0x90, 0x80, 0x80]))`, "1007 a text message must be UTF-8"],
    ["/echo", `c.send(1, Buffer.from([0x61, 0xe2, 0x82]))`, "1007 a text message must be UTF-8"],
    ["/echo", `c.send(8, Buffer.from([3, 232, 0xc0, 0x80]))`, "1007 a close reason must be UTF-8"],
    ["/small", `c.send(2, Buffer.alloc(11), { claim: 11n })`, "1009 message too big"],
    ["/echo", `c.send(2, "", { claim: 0x8000000000000000n })`, "1009 message too big"],
    // A continuation claiming the largest length a frame can, after a fragment.
    ["/echo", `(c.send(1, "a", { fin: false }), c.send(0, "", { claim: 0x7fffffffffffffffn }))`, "1009 message too big"],
  ];
}

test("protocol errors close the connection with RFC 6455's codes", () => {
  const cases = protocolCases();
  const acts = cases.map(([path, act, _close]) => `async (c) => { ${act}; }, ${JSON.stringify(path)}`);
  const r = run(`const cases = [${acts.map((a) => `[${a}]`).join(",\n")}];
let lasts = [];
for (const [act, path] of cases) {
  const c = await rawClient(port, path);
  await act(c);
  const frames = await c.rest();
  lasts.push(JSON.stringify(frames.at(-1)));
  await until("the server to end the connection", c.ended);
}
facts.lasts = lasts.join("\\n");
// None of it stopped the server.
const after = bunClient("ws://127.0.0.1:" + port + "/echo");
await after.opened;
after.ws.send("still serving");
await until("the echo", () => after.events.length === 1);
facts.after = after.events[0];
after.ws.close();
await after.closed;
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
  const r = run(String.raw`const c = await rawClient(port, "/small");
c.sock.pause();
const ping = Buffer.concat([Buffer.from([0x89, 125 | 128, 1, 2, 3, 4]), Buffer.alloc(125, 7)]);
const batch = Buffer.concat(Array(2000).fill(ping));
for (let i = 0; i < 40; i++) {
  c.sock.write(batch);
  await Bun.sleep(5);
}
await Bun.sleep(300);
c.sock.resume();
const frames = await c.rest();
facts.last = JSON.stringify(frames.at(-1));
facts.before = JSON.stringify([...new Set(frames.slice(0, -1).map(([opcode]) => opcode))]);
await stop();`, "");
  same(fact(r, "last"), `[8,"1013 send buffer full"]`, "the last frame");
  const before = fact(r, "before");
  assert(before === "[10]" || before === "[]", `frames other than pongs before the close: ${before}`);
}, { timeout: 60_000 });

test("another task sends through a sender, and sends after the close are dropped", () => {
  const r = run(String.raw`const push = bunClient("ws://127.0.0.1:" + port + "/push");
await push.opened;
await until("the task's message", () => push.events.length === 1);
facts.push = push.events[0];
push.ws.close();
await push.closed;
const closing = await rawClient(port, "/close");
facts.rest = JSON.stringify(await closing.rest());
closing.send(1, "still read");
closing.send(8, Buffer.from([15, 160]));
await until("the server to end the connection", closing.ended);
await stop();`, "");
  same(fact(r, "push"), "from another task", "the other task's message");
  same(fact(r, "rest"), `[[8,"4000 bye"]]`, "the frames up to the close");
}, { timeout: 60_000 });

test("a handler that returns closes with 1000, and one that panics with 1011, as a reserved close code does", () => {
  const r = run(String.raw`const done = bunClient("ws://127.0.0.1:" + port + "/return");
await done.closed;
facts.done = JSON.stringify(done.events);
const panicked = bunClient("ws://127.0.0.1:" + port + "/panic");
await panicked.opened;
panicked.ws.send("boom");
await panicked.closed;
facts.panicked = JSON.stringify(panicked.events);
const reserved = bunClient("ws://127.0.0.1:" + port + "/badclose");
await reserved.closed;
facts.reserved = JSON.stringify(reserved.events);
await stop();`, "");
  same(fact(r, "done"), `["one",["close",1000,""]]`, "the returning handler's events");
  same(fact(r, "panicked"), `[["close",1011,""]]`, "the panicking handler's events");
  same(fact(r, "reserved"), `[["close",1011,""]]`, "the reserved close code's events");
  assert(r.stderr.includes("the handler gave up"), `no panic message in:\n${r.stderr}`);
  assert(r.stderr.includes("a WebSocket close code is 1000 or one of 3000 to 4999, not 1006"), `no close code panic in:\n${r.stderr}`);
}, { timeout: 60_000 });

test("a silent client is pinged after the idle timeout, then dropped", () => {
  const r = run(String.raw`const c = await rawClient(port, "/small");
const ping = await c.frame();
facts.ping = ping?.opcode;
facts.next = JSON.stringify(await c.frame());
// A client answering pings, as Bun's does, stays.
const kept = bunClient("ws://127.0.0.1:" + port + "/small");
await kept.opened;
await Bun.sleep(900);
kept.ws.send("still here");
await until("the echo", () => kept.events.length === 1);
facts.kept = kept.events[0];
kept.ws.close();
await kept.closed;
await stop();`, "");
  same(fact(r, "ping"), "9", "the first frame's opcode");
  same(fact(r, "next"), "null", "what follows the ping");
  same(fact(r, "kept"), "still here", "the answering client's echo");
}, { timeout: 60_000 });

test("stopping the server closes open WebSockets with 1001", () => {
  const r = run(String.raw`const c = bunClient("ws://127.0.0.1:" + port + "/echo");
await c.opened;
await stop();
await c.closed;
facts.events = JSON.stringify(c.events);`, "");
  same(fact(r, "events"), `[["close",1001,""]]`, "the client's events");
  exitedWith(r, 0);
  assert(r.stderr.includes("stopped"), `serve never returned:\n${r.stderr}`);
}, { timeout: 60_000 });

test("wss: WebSockets over the server's TLS", () => {
  const fixtures = join(root(), "tests", "fixtures", "tls");
  const r = run(`const c = bunClient("wss://localhost:" + port + "/echo", { tls: { ca: fs.readFileSync(${JSON.stringify(join(fixtures, "ca.pem"))}, "utf8") } });
await c.opened;
c.ws.send("secret");
await until("the echo", () => c.events.length === 1);
c.ws.close();
await c.closed;
facts.echo = c.events[0];
await stop();`, fixtures);
  same(fact(r, "echo"), "secret", "the echo over TLS");
}, { timeout: 60_000 });
