import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newSession } from "../src/compilation.ts";
import { buildAsync } from "../src/main.ts";

// A Fish WebSocket server driven by Bun's WebSocket client, and by a raw socket for the frames
// a well-behaved client never sends. Building with clang can be slow on a busy machine.
setDefaultTimeout(60_000);

const tmp = mkdtempSync(join(tmpdir(), "fish-websocket-"));
const session = newSession();
const fixtures = join(import.meta.dir, "fixtures", "tls");

const SERVER = `import { readFileSync } from "node:fs";

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

let binary = "";
beforeAll(async () => {
  writeFileSync(join(tmp, "server.fsh"), SERVER);
  binary = join(tmp, "server");
  await buildAsync(session, join(tmp, "server.fsh"), binary);
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// A running server: its port once it says where it listens, and its stderr once it exits, which
// must report no leaks.
async function start(tlsDir = "") {
  const proc = Bun.spawn([binary, tlsDir], { env: { ...process.env, FISH_LEAKS: "1" }, stdout: "pipe", stderr: "pipe" });
  const reader = proc.stderr.getReader();
  let seen = "";
  const deadline = Date.now() + 10_000;
  while (!/listening (\d+)\n/.test(seen)) {
    if (Date.now() > deadline) throw new Error(`the server never listened: ${seen}`);
    const { value, done } = await reader.read();
    if (done) throw new Error(`the server ended: ${seen}`);
    seen += new TextDecoder().decode(value);
  }
  const port = Number(/listening (\d+)/.exec(seen)![1]);
  const stop = async () => {
    proc.kill("SIGTERM");
    const exited = await Promise.race([proc.exited, Bun.sleep(10_000).then(() => "hung")]);
    if (exited === "hung") proc.kill("SIGKILL");
    for (let read = await reader.read(); !read.done; read = await reader.read()) seen += new TextDecoder().decode(read.value);
    expect(seen).not.toContain("fish: leaked");
    return { exited, stderr: seen };
  };
  return { port, stop };
}

type Event = string | number[] | ["close", number, string];

// What a Bun WebSocket client sees: each message, then the close's code and reason.
function bunClient(url: string, options?: object): { ws: WebSocket; events: Event[]; opened: Promise<void>; closed: Promise<void> } {
  const ws = new WebSocket(url, options as never);
  ws.binaryType = "arraybuffer";
  const events: Event[] = [];
  const opened = new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error(`couldn't open ${url}`));
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
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(5);
  }
};

type Frame = { fin: boolean; opcode: number; payload: Buffer };

// A client speaking the protocol by hand: its handshake's response head, frames it sends masked
// or not, and the server's frames as they arrive, null once the connection ends.
async function rawClient(port: number, path: string, extra = "", requestLine = `GET ${path} HTTP/1.1`) {
  const sock: Socket = connect(port, "127.0.0.1");
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
  sock.write(`${requestLine}\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n${extra}\r\n`);
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
      seen.push([f.opcode, f.opcode === 8 ? `${f.payload.readUInt16BE(0)} ${f.payload.subarray(2)}` : f.payload.toString()]);
      if (f.opcode === 8) break;
    }
    return seen;
  };
  return { head, frame, send, rest, sock, ended: () => ended };
}

test("text, binary and large messages echo, and the client's close is answered", async () => {
  const server = await start();
  try {
    const c = bunClient(`ws://127.0.0.1:${server.port}/echo`);
    await c.opened;
    c.ws.send("hello");
    c.ws.send(new Uint8Array([1, 2, 255]));
    c.ws.send("é".repeat(40_000));
    await until("three echoes", () => c.events.length === 3);
    c.ws.close(1000, "done");
    await c.closed;
    expect(c.events.slice(0, 2)).toEqual(["hello", [1, 2, 255]]);
    expect(c.events[2]).toBe("é".repeat(40_000));
    expect(c.events[3]).toEqual(["close", 1000, expect.any(String)]);
  } finally {
    expect((await server.stop()).exited).toBe(0);
  }
});

test("path params, mounted routers and their middleware apply before the upgrade", async () => {
  const server = await start();
  try {
    const room = bunClient(`ws://127.0.0.1:${server.port}/room/a%20b`);
    await room.opened;
    await until("the greeting", () => room.events.length === 1);
    expect(room.events[0]).toBe("hi a b");
    room.ws.close();
    await room.closed;
    // Middleware refusing the request answers it as it would any other.
    const refused = await rawClient(server.port, "/secret");
    expect(refused.head).toStartWith("HTTP/1.1 401 Unauthorized");
    refused.sock.destroy();
    const inside = bunClient(`ws://127.0.0.1:${server.port}/secret`, { headers: { "x-token": "let me in" } });
    await inside.opened;
    await until("the greeting", () => inside.events.length === 1);
    expect(inside.events[0]).toBe("inside");
    inside.ws.close();
    await inside.closed;
    // A plain GET, a wrong version, a bad key, a HEAD and HTTP/1.0 are refused without upgrading.
    const plain = await fetch(`http://127.0.0.1:${server.port}/echo`);
    expect(plain.status).toBe(426);
    expect(plain.headers.get("upgrade")).toBe("websocket");
    await plain.text();
    const version = await fetch(`http://127.0.0.1:${server.port}/echo`, { headers: { upgrade: "websocket", connection: "Upgrade", "sec-websocket-version": "8", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" } });
    expect([version.status, version.headers.get("sec-websocket-version")]).toEqual([426, "13"]);
    await version.text();
    const key = await fetch(`http://127.0.0.1:${server.port}/echo`, { headers: { upgrade: "websocket", connection: "Upgrade", "sec-websocket-version": "13", "sec-websocket-key": "short" } });
    expect(key.status).toBe(400);
    await key.text();
    // RFC 6455 upgrades a GET over HTTP/1.1 only.
    for (const [line, status] of [["HEAD /echo HTTP/1.1", "405 Method Not Allowed"], ["GET /echo HTTP/1.0", "400 Bad Request"]] as const) {
      const c = await rawClient(server.port, "/echo", "", line);
      expect(c.head).toStartWith(`HTTP/1.1 ${status}\r\n`);
      c.sock.destroy();
    }
  } finally {
    await server.stop();
  }
});

test("the handshake's accept key is RFC 6455's, and no extension or subprotocol is agreed", async () => {
  const server = await start();
  try {
    const c = await rawClient(server.port, "/echo", "Sec-WebSocket-Extensions: permessage-deflate\r\nSec-WebSocket-Protocol: chat\r\n");
    expect(c.head).toStartWith("HTTP/1.1 101 Switching Protocols\r\n");
    expect(c.head).toContain("\r\nsec-websocket-accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n");
    expect(c.head.toLowerCase()).not.toContain("sec-websocket-extensions");
    expect(c.head.toLowerCase()).not.toContain("sec-websocket-protocol");
    c.send(8, Buffer.from([3, 232]));
    expect(await c.rest()).toEqual([[8, "1000 "]]);
  } finally {
    await server.stop();
  }
});

test("fragments make one message, even splitting a character, pings get pongs between them, the 8-byte length form reads, and a close is echoed", async () => {
  const server = await start();
  try {
    const c = await rawClient(server.port, "/echo");
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
    expect(await c.rest()).toEqual([[10, "are you there"], [1, "fragmented"], [2, "\x07\x08\t"], [2, "\x05\x06"], [1, "é"], [8, "3000 "]]);
  } finally {
    await server.stop();
  }
});

test("protocol errors close the connection with RFC 6455's codes", async () => {
  const server = await start();
  try {
    const cases: [string, (c: Awaited<ReturnType<typeof rawClient>>) => void, string][] = [
      ["/echo", (c) => c.send(1, "plain", { mask: false }), "1002 a client's frames must be masked"],
      ["/echo", (c) => c.send(1, Buffer.from([0xc3, 0x28])), "1007 a text message must be UTF-8"],
      ["/echo", (c) => c.send(1, Buffer.from([0xed, 0xa0, 0x80])), "1007 a text message must be UTF-8"],
      ["/echo", (c) => c.send(0, "orphan"), "1002 a continuation frame with no message to continue"],
      ["/echo", (c) => (c.send(1, "a", { fin: false }), c.send(1, "b")), "1002 a new message began before the last one ended"],
      ["/echo", (c) => c.send(9, "x", { fin: false }), "1002 control frames are whole and at most 125 bytes"],
      ["/echo", (c) => c.send(3, "x"), "1002 unknown opcode"],
      ["/echo", (c) => c.send(8, Buffer.from([3, 237])), "1002 a close code the protocol doesn't allow"],
      ["/small", (c) => c.send(2, Buffer.alloc(11)), "1009 message too big"],
      ["/small", (c) => (c.send(1, "123456", { fin: false }), c.send(0, "78901")), "1009 message too big"],
      ["/small", (c) => c.send(1, "flood"), "1013 send buffer full"],
      ["/echo", (c) => c.send(1, Buffer.from([0xc0, 0x80])), "1007 a text message must be UTF-8"],
      ["/echo", (c) => c.send(1, Buffer.from([0xe0, 0x80, 0x80])), "1007 a text message must be UTF-8"],
      ["/echo", (c) => c.send(1, Buffer.from([0xf4, 0x90, 0x80, 0x80])), "1007 a text message must be UTF-8"],
      ["/echo", (c) => c.send(1, Buffer.from([0x61, 0xe2, 0x82])), "1007 a text message must be UTF-8"],
      ["/echo", (c) => c.send(8, Buffer.from([3, 232, 0xc0, 0x80])), "1007 a close reason must be UTF-8"],
      ["/small", (c) => c.send(2, Buffer.alloc(11), { claim: 11n }), "1009 message too big"],
      ["/echo", (c) => c.send(2, "", { claim: 0x8000000000000000n }), "1009 message too big"],
      // A continuation claiming the largest length a frame can, after a fragment.
      ["/echo", (c) => (c.send(1, "a", { fin: false }), c.send(0, "", { claim: 0x7fffffffffffffffn })), "1009 message too big"],
    ];
    for (const [path, act, close] of cases) {
      const c = await rawClient(server.port, path);
      act(c);
      const frames = await c.rest();
      expect(frames.at(-1)).toEqual([8, close]);
      await until("the server to end the connection", c.ended);
    }
    // None of it stopped the server.
    const after = bunClient(`ws://127.0.0.1:${server.port}/echo`);
    await after.opened;
    after.ws.send("still serving");
    await until("the echo", () => after.events.length === 1);
    expect(after.events[0]).toBe("still serving");
    after.ws.close();
    await after.closed;
  } finally {
    await server.stop();
  }
});

test("pongs to a client that stops reading count against maxBuffered, closing with 1013", async () => {
  const server = await start();
  try {
    const c = await rawClient(server.port, "/small");
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
    expect(frames.at(-1)).toEqual([8, "1013 send buffer full"]);
    expect(frames.slice(0, -1).every(([opcode]) => opcode === 10)).toBe(true);
  } finally {
    await server.stop();
  }
});

test("another task sends through a sender, and sends after the close are dropped", async () => {
  const server = await start();
  try {
    const push = bunClient(`ws://127.0.0.1:${server.port}/push`);
    await push.opened;
    await until("the task's message", () => push.events.length === 1);
    expect(push.events[0]).toBe("from another task");
    push.ws.close();
    await push.closed;
    const closing = await rawClient(server.port, "/close");
    expect(await closing.rest()).toEqual([[8, "4000 bye"]]);
    closing.send(1, "still read");
    closing.send(8, Buffer.from([15, 160]));
    await until("the server to end the connection", closing.ended);
  } finally {
    await server.stop();
  }
});

test("a handler that returns closes with 1000, and one that panics with 1011, as a reserved close code does", async () => {
  const server = await start();
  try {
    const done = bunClient(`ws://127.0.0.1:${server.port}/return`);
    await done.closed;
    expect(done.events).toEqual(["one", ["close", 1000, ""]]);
    const panicked = bunClient(`ws://127.0.0.1:${server.port}/panic`);
    await panicked.opened;
    panicked.ws.send("boom");
    await panicked.closed;
    expect(panicked.events).toEqual([["close", 1011, ""]]);
    const reserved = bunClient(`ws://127.0.0.1:${server.port}/badclose`);
    await reserved.closed;
    expect(reserved.events).toEqual([["close", 1011, ""]]);
  } finally {
    const { stderr } = await server.stop();
    expect(stderr).toContain("the handler gave up");
    expect(stderr).toContain("a WebSocket close code is 1000 or one of 3000 to 4999, not 1006");
  }
});

test("a silent client is pinged after the idle timeout, then dropped", async () => {
  const server = await start();
  try {
    const c = await rawClient(server.port, "/small");
    const ping = await c.frame();
    expect(ping?.opcode).toBe(9);
    expect(await c.frame()).toBeNull();
    // A client answering pings, as Bun's does, stays.
    const kept = bunClient(`ws://127.0.0.1:${server.port}/small`);
    await kept.opened;
    await Bun.sleep(900);
    kept.ws.send("still here");
    await until("the echo", () => kept.events.length === 1);
    expect(kept.events[0]).toBe("still here");
    kept.ws.close();
    await kept.closed;
  } finally {
    await server.stop();
  }
});

test("stopping the server closes open WebSockets with 1001", async () => {
  const server = await start();
  const c = bunClient(`ws://127.0.0.1:${server.port}/echo`);
  await c.opened;
  const { exited, stderr } = await server.stop();
  await c.closed;
  expect(c.events).toEqual([["close", 1001, ""]]);
  expect(exited).toBe(0);
  expect(stderr).toContain("stopped");
});

test("wss: WebSockets over the server's TLS", async () => {
  const server = await start(fixtures);
  try {
    const c = bunClient(`wss://localhost:${server.port}/echo`, { tls: { ca: readFileSync(join(fixtures, "ca.pem"), "utf8") } });
    await c.opened;
    c.ws.send("secret");
    await until("the echo", () => c.events.length === 1);
    c.ws.close();
    await c.closed;
    expect(c.events[0]).toBe("secret");
  } finally {
    await server.stop();
  }
});
