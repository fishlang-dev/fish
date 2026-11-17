// Ports tests/shutdown.test.ts: signals, process.shutdown and serve's drain. Each program runs under
// `sh`, which starts a Node driver in the background and then execs the program, so the test sees
// the program's own exit code and signal. The driver, given the program's pid and the file its
// stderr goes to, waits for the program's ready lines, sends its signals, acts as its clients, and
// writes what it saw to a file once done: one fact per line, a name, a tab and a JSON string.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { built, removed, same, scratch, text } from "./support.fsh";

// What a program's run gave: its exit code or the signal that ended it, its stdout and stderr, and
// the driver's facts.
type Run = { code: i64 | null; signal: string | null; stdout: string; stderr: string; facts: string };

// What every driver starts with: waiting for a stderr line, for the program to exit, and writing
// the facts once its own `drive()` ends, or the error that stopped it.
function prelude(): string {
  return String.raw`const fs = require("node:fs");
const net = require("node:net");
const pid = Number(process.argv[2]);
const errFile = process.argv[3];
const doneFile = process.argv[4];
const facts = {};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stderr = () => { try { return fs.readFileSync(errFile, "utf8"); } catch { return ""; } };
const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function line(text) {
  const deadline = Date.now() + 10000;
  for (;;) {
    const found = stderr().split("\n").slice(0, -1).find((l) => (typeof text === "string" ? l === text : text.test(l)));
    if (found !== undefined) return found;
    if (!alive()) throw new Error("the program exited before " + String(text) + "; stderr: " + JSON.stringify(stderr()));
    if (Date.now() > deadline) {
      process.kill(pid, "SIGKILL");
      throw new Error("timed out waiting for " + String(text) + "; stderr so far: " + JSON.stringify(stderr()));
    }
    await sleep(10);
  }
}
async function exited() {
  const deadline = Date.now() + 10000;
  while (alive()) {
    if (Date.now() > deadline) {
      process.kill(pid, "SIGKILL");
      throw new Error("timed out waiting for the program to exit");
    }
    await sleep(10);
  }
}
const port = async () => Number((await line(/^listening \d+$/)).split(" ")[1]);
function finish() {
  fs.writeFileSync(doneFile + ".part", Object.entries(facts).map(([k, v]) => k + "\t" + JSON.stringify(String(v))).join("\n"));
  fs.renameSync(doneFile + ".part", doneFile);
}
drive().then(finish, (e) => { facts.error = e.message; finish(); });
`;
}

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

// Runs `binary` with FISH_LEAKS set, driven by `driver`, the body of an async `drive()`; with `fifo`,
// its stdout goes to a FIFO nobody reads. Its stderr must report no leaks.
function run(tmp: string, binary: string, driver: string, fifo: boolean): Run {
  const err = join(tmp, "stderr");
  const done = join(tmp, "facts");
  const drv = join(tmp, "drive.cjs");
  write(drv, `${prelude()}\nasync function drive() {\n${driver}\n}\n`);
  const script = `err=$1 bin=$2 drv=$3 done=$4 fifo=$5
node "$drv" $$ "$err" "$done" > /dev/null 2>&1 &
if [ -n "$fifo" ]; then
  mkfifo "$fifo" && exec 3<> "$fifo"
  exec env FISH_LEAKS=1 "$bin" 2> "$err" >&3
fi
exec env FISH_LEAKS=1 "$bin" 2> "$err"`;
  const ran = spawnSync("sh", ["-c", script, "sh", err, binary, drv, done, fifo ? join(tmp, "stuck.fifo") : ""]);
  // The driver writes its facts once it is done, which may be just after the program exits.
  spawnSync("sh", ["-c", `n=0; while [ ! -e "$1" ] && [ $n -lt 100 ]; do sleep 0.05; n=$((n + 1)); done`, "sh", done]);
  const stderr = existsSync(err) ? readText(err) : "";
  assert(!stderr.includes("fish: leaked"), `the program leaked:\n${stderr}`);
  const facts = existsSync(done) ? readText(done) : "error\t\"the driver never finished\"";
  return { code: ran.status, signal: ran.signal, stdout: text(ran.stdout), stderr, facts };
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
    assert(key !== "error", `the driver failed: ${value}`);
    if (key === name) found = value;
  }
  return found;
}

// Fails the test unless the program ended as wanted.
function ended(r: Ref<Run>, stdout: string, code: i64 | null, signal: string | null): void {
  fact(r, "");
  same(`${JSON.stringify(r.stdout)} ${JSON.stringify(r.code)} ${JSON.stringify(r.signal)}`, `${JSON.stringify(stdout)} ${JSON.stringify(code)} ${JSON.stringify(signal)}`, `the stdout, exit code and signal (stderr: ${r.stderr})`);
}

function aborted(): string {
  return `async function main(): Promise<void> {
  const stop = process.shutdown;
  console.error("ready");
  try {
    await sleep(60000, stop);
    console.log("slept");
  } catch (e) {
    console.log("aborted", e instanceof AbortError, process.shutdown.aborted);
  }
}
`;
}

function abortedBy(signal: string): void {
  const tmp = scratch("fish-shutdown-");
  const r = run(tmp, built(tmp, `aborted_${signal}`, aborted()), `await line("ready");\nprocess.kill(pid, "${signal}");`, false);
  ended(r, "aborted true true\n", 0, null);
  removed(tmp);
}

test("one SIGTERM aborts process.shutdown and the program ends normally", () => {
  abortedBy("SIGTERM");
});

test("one SIGINT aborts process.shutdown and the program ends normally", () => {
  abortedBy("SIGINT");
});

function ignored(): string {
  return `async function main(): Promise<void> {
  const stop = process.shutdown;
  console.log("before");
  console.error("ready");
  try {
    await sleep(60000, stop);
  } catch (e) {
    console.log("noticed");
    console.error("noticed");
  }
  await sleep(60000);
  console.log("never");
}
`;
}

function signalledTwice(signal: string, code: i64): void {
  const tmp = scratch("fish-shutdown-");
  const r = run(tmp, built(tmp, `ignored_${signal}`, ignored()), `await line("ready");\nprocess.kill(pid, "${signal}");\nawait line("noticed");\nprocess.kill(pid, "${signal}");`, false);
  ended(r, "before\nnoticed\n", code, null);
  removed(tmp);
}

test("a second SIGINT exits at once with 130", () => {
  signalledTwice("SIGINT", 130);
});

test("a second SIGTERM exits at once with 143", () => {
  signalledTwice("SIGTERM", 143);
});

test("a program that never names process.shutdown dies at its first SIGINT", () => {
  const tmp = scratch("fish-shutdown-");
  const binary = built(tmp, "plain", `async function main(): Promise<void> {
  console.error("ready");
  await sleep(60000);
  console.log("never");
}
`);
  const r = run(tmp, binary, `await line("ready");\nprocess.kill(pid, "SIGINT");`, false);
  ended(r, "", null, "SIGINT");
  removed(tmp);
});

function slow(): string {
  return `async function main(): Promise<void> throws IoError {
  await serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => console.error("listening " + String(info.port)) }, async (_req: Request) => {
    console.error("handling");
    await sleep(2000);
    return new Response("done slowly");
  });
  console.log("after serve");
}
`;
}

test("serve stops accepting at SIGINT and finishes the request in flight", () => {
  const tmp = scratch("fish-shutdown-");
  // Whether a new connection to the port is refused, rather than accepted into the backlog.
  const r = run(tmp, built(tmp, "slow", slow()), String.raw`const p = await port();
const refused = () => new Promise((resolve) => {
  const socket = net.connect(p, "127.0.0.1");
  socket.once("connect", () => { socket.destroy(); resolve(false); });
  socket.once("error", () => resolve(true));
});
const answer = fetch("http://127.0.0.1:" + p + "/").then(async (res) => [res.status, await res.text()]);
await line("handling");
process.kill(pid, "SIGINT");
// The listener closes once the accept loop sees the signal; until then a probe may still land.
const deadline = Date.now() + 1500;
let closed = false;
while (!closed && Date.now() < deadline) closed = await refused();
facts.closed = closed;
facts.answer = JSON.stringify(await Promise.race([answer, sleep(10000).then(() => "no answer")]));
await exited();`, false);
  same(fact(r, "closed"), "true", "whether the listener closed");
  same(fact(r, "answer"), `[200,"done slowly"]`, "the request in flight's answer");
  ended(r, "after serve\n", 0, null);
  removed(tmp);
});

test("serve given its own signal leaves SIGINT alone", () => {
  const tmp = scratch("fish-shutdown-");
  const binary = built(tmp, "own", `async function main(): Promise<void> throws IoError {
  const ctl = new AbortController();
  await serve({ port: 0, hostname: "127.0.0.1", signal: ctl.signal, onListen: (_info: ServeInfo) => console.error("listening") }, async (_req: Request) => new Response("hi"));
  console.log("after serve");
}
`);
  const r = run(tmp, binary, `await line("listening");\nprocess.kill(pid, "SIGINT");`, false);
  ended(r, "", null, "SIGINT");
  removed(tmp);
});

// A FIFO opened for reading and writing, so opening it doesn't wait, that the test never reads.
test("a second SIGINT exits even while stdout is stuck on a full pipe", () => {
  const tmp = scratch("fish-shutdown-");
  const binary = built(tmp, "stuck", `async function main(): Promise<void> {
  const _stop = process.shutdown;
  console.error("ready");
  while (true) console.log("filling the pipe that nobody reads, until a write blocks");
}
`);
  // Long enough for the loop to fill the pipe and block in a write holding stdout's lock.
  const r = run(tmp, binary, `await line("ready");\nawait sleep(500);\nprocess.kill(pid, "SIGINT");\nawait sleep(100);\nprocess.kill(pid, "SIGINT");`, true);
  ended(r, "", 130, null);
  removed(tmp);
});

function firehose(): string {
  return `async function* firehose(): AsyncGenerator<string> {
  let s = "";
  for (let i = 0; i < 65536; i++) s = s + "y";
  while (true) yield s;
}

async function main(): Promise<void> throws IoError {
  await serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => console.error("listening " + String(info.port)) }, async (_req: Request) => new Response(firehose()));
  console.log("after serve");
}
`;
}

test("a stream to a client that stops reading ends at SIGINT, freeing its connection", () => {
  const tmp = scratch("fish-shutdown-");
  const r = run(tmp, built(tmp, "firehose", firehose()), String.raw`const p = await port();
const socket = net.connect(p, "127.0.0.1");
socket.write("GET / HTTP/1.1\r\nHost: h\r\n\r\n");
// Nothing is read until the server's writes have filled both sides' buffers and block.
socket.pause();
await sleep(500);
process.kill(pid, "SIGINT");
await exited();
const ended = new Promise((resolve) => {
  socket.on("end", () => resolve(true));
  socket.on("error", () => resolve(true));
});
socket.resume();
facts.ended = await Promise.race([ended, sleep(5000).then(() => false)]);
socket.destroy();`, false);
  ended(r, "after serve\n", 0, null);
  same(fact(r, "ended"), "true", "whether the connection ended");
  removed(tmp);
});

test("a stream's write under way at SIGINT gets a second's grace, then the stream ends cleanly", () => {
  const tmp = scratch("fish-shutdown-");
  const r = run(tmp, built(tmp, "firehose_grace", firehose()), String.raw`const p = await port();
const socket = net.connect(p, "127.0.0.1");
let text = "";
const ended = new Promise((resolve) => {
  socket.on("data", (d) => (text = (text + d.toString()).slice(-16)));
  socket.on("end", () => resolve(true));
  socket.on("error", () => resolve(false));
});
socket.write("GET / HTTP/1.1\r\nHost: h\r\n\r\n");
socket.pause();
await sleep(500);
process.kill(pid, "SIGINT");
// Reading again within the second lets the blocked write and the last chunk go out.
await sleep(200);
socket.resume();
facts.ended = await Promise.race([ended, sleep(5000).then(() => false)]);
facts.tail = text;
await exited();`, false);
  same(fact(r, "ended"), "true", "whether the stream ended");
  assert(fact(r, "tail").endsWith("\r\n0\r\n\r\n"), `the stream ended with ${JSON.stringify(fact(r, "tail"))}`);
  ended(r, "after serve\n", 0, null);
  removed(tmp);
});

// A half-closed client looks the same as one that has gone, so its end of the stream ends a
// streamed body as Node's server does: the head goes out, the body is cut short with no last
// chunk, and the connection is closed.
test("a client that half-closes after its request gets the head and a cut-short streamed body", () => {
  const tmp = scratch("fish-shutdown-");
  const binary = built(tmp, "halfclose", `async function* pieces(): AsyncGenerator<string> {
  for (let i = 0; i < 3; i++) {
    await sleep(20);
    yield "piece " + String(i) + ";";
  }
}

async function main(): Promise<void> throws IoError {
  const ctl = new AbortController();
  await serve({ port: 0, hostname: "127.0.0.1", signal: ctl.signal, onListen: (info: ServeInfo) => console.error("listening " + String(info.port)) }, async (req: Request) => {
    if (req.path === "/stop") ctl.abort();
    return new Response(pieces());
  });
}
`);
  const r = run(tmp, binary, String.raw`const p = await port();
facts.received = await new Promise((resolve) => {
  const socket = net.connect({ port: p, host: "127.0.0.1", allowHalfOpen: true });
  let text = "";
  socket.on("data", (d) => (text += d.toString()));
  socket.on("end", () => resolve(text));
  socket.write("GET / HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n", () => socket.end());
});
await fetch("http://127.0.0.1:" + p + "/stop").then((res) => res.text());
await exited();`, false);
  const received = fact(r, "received");
  assert(received.startsWith("HTTP/1.1 200 OK\r\n"), `received ${JSON.stringify(received)}`);
  assert(received.includes("transfer-encoding: chunked\r\n"), `no chunked encoding in ${JSON.stringify(received)}`);
  assert(!received.includes("piece 2;"), `the whole body in ${JSON.stringify(received)}`);
  assert(!received.endsWith("0\r\n\r\n"), `a last chunk in ${JSON.stringify(received)}`);
  removed(tmp);
});

test("a handler that panics gets its request a bare 500, and the server keeps serving", () => {
  const tmp = scratch("fish-shutdown-");
  const binary = built(tmp, "panicky", `async function main(): Promise<void> throws IoError {
  await serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => console.error("listening " + String(info.port)) }, async (req: Request) => {
    if (req.url.endsWith("/boom")) {
      const xs = ["held" + req.url];
      return new Response(xs[5]);
    }
    return new Response("fine");
  });
  console.log("after serve");
}
`);
  // One raw HTTP/1.1 request, and everything the server sends until it closes the connection.
  const r = run(tmp, binary, String.raw`const p = await port();
facts.failed = await new Promise((resolve, reject) => {
  const socket = net.connect(p, "127.0.0.1", () => socket.write("GET /boom HTTP/1.1\r\nhost: 127.0.0.1\r\nconnection: close\r\n\r\n"));
  let got = "";
  socket.on("data", (d) => (got += d.toString()));
  socket.on("end", () => resolve(got));
  socket.on("error", reject);
});
await line("index out of bounds: the len is 1 but the index is 5");
let answers = [];
for (const path of ["/a", "/boom", "/b"]) {
  const answer = await fetch("http://127.0.0.1:" + p + path);
  answers.push([answer.status, await answer.text()]);
}
facts.answers = JSON.stringify(answers);
process.kill(pid, "SIGTERM");
await exited();`, false);
  const failed = fact(r, "failed");
  assert(failed.startsWith("HTTP/1.1 500 Internal Server Error\r\n"), `the panicking request got ${JSON.stringify(failed)}`);
  assert(failed.toLowerCase().includes("\r\nconnection: close\r\n"), `no connection: close in ${JSON.stringify(failed)}`);
  assert(failed.toLowerCase().includes("\r\ncontent-length: 0\r\n"), `no content-length: 0 in ${JSON.stringify(failed)}`);
  assert(failed.endsWith("\r\n\r\n"), `a body in ${JSON.stringify(failed)}`);
  same(fact(r, "answers"), `[[200,"fine"],[500,""],[200,"fine"]]`, "the answers after the panic");
  ended(r, "after serve\n", 0, null);
  assert(/panicked at .*panicky\.fsh:5:\d+:\nindex out of bounds/.test(r.stderr), `no panic report in:\n${r.stderr}`);
  removed(tmp);
});

test("a detached task's panic is printed and the program ends normally", () => {
  const tmp = scratch("fish-shutdown-");
  const binary = built(tmp, "detached", `async function boom(): Promise<void> {
  const xs = ["a" + 1];
  await yieldNow();
  console.log(xs[2]);
}
async function main() {
  spawn(boom());
  await sleep(100);
  console.log("main finished");
}
`);
  const r = spawnSync("env", ["FISH_LEAKS=1", binary]);
  const stderr = text(r.stderr);
  assert(!stderr.includes("fish: leaked"), `the program leaked:\n${stderr}`);
  same(`${JSON.stringify(text(r.stdout))} ${JSON.stringify(r.status)} ${JSON.stringify(r.signal)}`, `"main finished\\n" 0 null`, "the stdout, exit code and signal");
  assert(/^panicked at .*detached\.fsh:4:(\d+):\nindex out of bounds: the len is 1 but the index is 2\nstack backtrace:\n   0: boom at .*detached\.fsh:4:\1\nspawned at .*detached\.fsh:7:3\n$/.test(stderr), `the panic report:\n${stderr}`);
  removed(tmp);
});

test("a Router route that panics answers 500 while the other routes keep working", () => {
  const tmp = scratch("fish-shutdown-");
  const binary = built(tmp, "routed", `async function main(): Promise<void> throws IoError {
  let app = new Router();
  app.get("/users/:id", async (req) => new Response("user " + req.param("id")));
  app.get("/boom", async (req) => {
    const xs = [req.path];
    return new Response(xs[3]);
  });
  await serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => console.error("listening " + String(info.port)) }, app.handler());
  console.log("after serve");
}
`);
  const r = run(tmp, binary, String.raw`const p = await port();
let answers = [];
for (const path of ["/users/1", "/boom", "/users/2", "/boom", "/users/3"]) {
  const answer = await fetch("http://127.0.0.1:" + p + path);
  answers.push([answer.status, await answer.text()]);
}
facts.answers = JSON.stringify(answers);
process.kill(pid, "SIGTERM");
await exited();`, false);
  same(fact(r, "answers"), `[[200,"user 1"],[500,""],[200,"user 2"],[500,""],[200,"user 3"]]`, "the answers");
  ended(r, "after serve\n", 0, null);
  const panics = r.stderr.match(/index out of bounds: the len is 1 but the index is 3/g);
  const count = panics === null ? 0 : panics.length;
  assert(count === 2, `${count} panics reported in:\n${r.stderr}`);
  removed(tmp);
});
