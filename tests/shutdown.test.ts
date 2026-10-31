import { expect, setDefaultTimeout, test } from "bun:test";
import { connect } from "node:net";
import { closeSync, mkdtempSync, openSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each test builds a program with clang, which can take past bun's 5 seconds on a busy machine.
setDefaultTimeout(60_000);

const tmp = mkdtempSync(join(tmpdir(), "fish-shutdown-"));

async function build(name: string, src: string): Promise<string> {
  const program = join(tmp, `${name}.fsh`);
  writeFileSync(program, src);
  const out = join(tmp, name);
  const built = Bun.spawn(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out], { stderr: "pipe" });
  const errors = await new Response(built.stderr).text();
  expect(errors).toBe("");
  expect(await built.exited).toBe(0);
  return out;
}

// A running program, its stdout collected once it exits and checked for leaks. Ready lines go to stderr, which is
// unbuffered, so the test can wait for them; every wait is bounded so a hang fails the test.
// Given a file descriptor, stdout goes there instead and isn't collected.
function start(binary: string, out?: number) {
  const proc = Bun.spawn([binary], { env: { ...process.env, FISH_LEAKS: "1" }, stdout: out ?? "pipe", stderr: "pipe" });
  const stdout = out === undefined ? new Response(proc.stdout as ReadableStream).text() : Promise.resolve("");
  const reader = proc.stderr.getReader();
  let seen = "";
  async function within<T>(ms: number, what: string, p: Promise<T>): Promise<T> {
    try {
      return await Promise.race([p, Bun.sleep(ms).then(() => Promise.reject(new Error(`timed out waiting for ${what}; stderr so far: ${JSON.stringify(seen)}`)))]);
    } catch (e) {
      proc.kill("SIGKILL");
      throw e;
    }
  }
  // The first whole stderr line equal to text, or matching it.
  const line = (text: string | RegExp) =>
    within(10_000, String(text), (async () => {
      for (;;) {
        const found = seen.split("\n").slice(0, -1).find((l) => (typeof text === "string" ? l === text : text.test(l)));
        if (found !== undefined) return found;
        const { value, done } = await reader.read();
        if (done) throw new Error(`stderr ended before ${String(text)}: ${JSON.stringify(seen)}`);
        seen += new TextDecoder().decode(value);
      }
    })());
  async function exited() {
    await within(10_000, "the program to exit", proc.exited);
    for (let read = await reader.read(); !read.done; read = await reader.read()) seen += new TextDecoder().decode(read.value);
    expect(seen).not.toContain("fish: leaked");
    return { stdout: await stdout, exitCode: proc.exitCode, signal: proc.signalCode };
  }
  return { proc, line, exited, stderr: () => seen };
}

const ABORTED = `async function main(): Promise<void> {
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

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  test(`one ${signal} aborts process.shutdown and the program ends normally`, async () => {
    const run = start(await build(`aborted_${signal}`, ABORTED));
    await run.line("ready");
    run.proc.kill(signal);
    expect(await run.exited()).toEqual({ stdout: "aborted true true\n", exitCode: 0, signal: null });
  });
}

const IGNORED = `async function main(): Promise<void> {
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

for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
  test(`a second ${signal} exits at once with ${code}`, async () => {
    const run = start(await build(`ignored_${signal}`, IGNORED));
    await run.line("ready");
    run.proc.kill(signal);
    await run.line("noticed");
    run.proc.kill(signal);
    expect(await run.exited()).toEqual({ stdout: "before\nnoticed\n", exitCode: code, signal: null });
  });
}

test("a program that never names process.shutdown dies at its first SIGINT", async () => {
  const run = start(await build("plain", `async function main(): Promise<void> {
  console.error("ready");
  await sleep(60000);
  console.log("never");
}
`));
  await run.line("ready");
  run.proc.kill("SIGINT");
  expect(await run.exited()).toEqual({ stdout: "", exitCode: null, signal: "SIGINT" });
});

// Whether a new connection to the port is refused, rather than accepted into the backlog.
const refused = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(true));
  });

const SLOW = `async function main(): Promise<void> throws IoError {
  await serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => console.error("listening " + String(info.port)) }, async (_req: Request) => {
    console.error("handling");
    await sleep(2000);
    return new Response("done slowly");
  });
  console.log("after serve");
}
`;

test("serve stops accepting at SIGINT and finishes the request in flight", async () => {
  const run = start(await build("slow", SLOW));
  const port = Number((await run.line(/^listening \d+$/)).split(" ")[1]);
  const answer = fetch(`http://127.0.0.1:${port}/`).then(async (res) => [res.status, await res.text()]);
  await run.line("handling");
  run.proc.kill("SIGINT");
  // The listener closes once the accept loop sees the signal; until then a probe may still land.
  const deadline = Date.now() + 1500;
  let closed = false;
  while (!closed && Date.now() < deadline) closed = await refused(port);
  expect(closed).toBe(true);
  expect(await Promise.race([answer, Bun.sleep(10_000).then(() => "no answer")])).toEqual([200, "done slowly"]);
  expect(await run.exited()).toEqual({ stdout: "after serve\n", exitCode: 0, signal: null });
});

test("serve given its own signal leaves SIGINT alone", async () => {
  const run = start(await build("own", `async function main(): Promise<void> throws IoError {
  const ctl = new AbortController();
  await serve({ port: 0, hostname: "127.0.0.1", signal: ctl.signal, onListen: (_info: ServeInfo) => console.error("listening") }, async (_req: Request) => new Response("hi"));
  console.log("after serve");
}
`));
  await run.line("listening");
  run.proc.kill("SIGINT");
  expect(await run.exited()).toEqual({ stdout: "", exitCode: null, signal: "SIGINT" });
});

test("a second SIGINT exits even while stdout is stuck on a full pipe", async () => {
  const binary = await build("stuck", `async function main(): Promise<void> {
  const _stop = process.shutdown;
  console.error("ready");
  while (true) console.log("filling the pipe that nobody reads, until a write blocks");
}
`);
  // A FIFO opened for reading and writing, so opening it doesn't wait, that the test never reads.
  const fifo = join(tmp, "stuck.fifo");
  expect(Bun.spawnSync(["mkfifo", fifo]).exitCode).toBe(0);
  const fd = openSync(fifo, "r+");
  try {
    const run = start(binary, fd);
    await run.line("ready");
    // Long enough for the loop to fill the pipe and block in a write holding stdout's lock.
    await Bun.sleep(500);
    run.proc.kill("SIGINT");
    await Bun.sleep(100);
    run.proc.kill("SIGINT");
    const { exitCode, signal } = await run.exited();
    expect({ exitCode, signal }).toEqual({ exitCode: 130, signal: null });
  } finally {
    closeSync(fd);
  }
});

// One raw HTTP/1.1 request, and everything the server sends until it closes the connection.
const exchange = (port: number, path: string) =>
  new Promise<string>((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => socket.write(`GET ${path} HTTP/1.1\r\nhost: 127.0.0.1\r\nconnection: close\r\n\r\n`));
    let got = "";
    socket.on("data", (d) => (got += d.toString()));
    socket.on("end", () => resolve(got));
    socket.on("error", reject);
  });

const PANICKY = `async function main(): Promise<void> throws IoError {
  await serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => console.error("listening " + String(info.port)) }, async (req: Request) => {
    if (req.url.endsWith("/boom")) {
      const xs = ["held" + req.url];
      return new Response(xs[5]);
    }
    return new Response("fine");
  });
  console.log("after serve");
}
`;

test("a handler that panics gets its request a bare 500, and the server keeps serving", async () => {
  const run = start(await build("panicky", PANICKY));
  const port = Number((await run.line(/^listening \d+$/)).split(" ")[1]);
  const failed = await exchange(port, "/boom");
  expect(failed).toStartWith("HTTP/1.1 500 Internal Server Error\r\n");
  expect(failed.toLowerCase()).toContain("\r\nconnection: close\r\n");
  expect(failed.toLowerCase()).toContain("\r\ncontent-length: 0\r\n");
  expect(failed).toEndWith("\r\n\r\n");
  await run.line("index out of bounds: the len is 1 but the index is 5");
  for (const path of ["/a", "/boom", "/b"]) {
    const answer = await fetch(`http://127.0.0.1:${port}${path}`);
    expect([answer.status, await answer.text()]).toEqual(path === "/boom" ? [500, ""] : [200, "fine"]);
  }
  run.proc.kill("SIGTERM");
  expect(await run.exited()).toEqual({ stdout: "after serve\n", exitCode: 0, signal: null });
  expect(run.stderr()).toMatch(/panicked at .*panicky\.fsh:5:\d+:\nindex out of bounds/);
});

test("a detached task's panic is printed and the program ends normally", async () => {
  const run = start(await build("detached", `async function boom(): Promise<void> {
  const xs = ["a" + 1];
  await yieldNow();
  console.log(xs[2]);
}
async function main() {
  spawn(boom());
  await sleep(100);
  console.log("main finished");
}
`));
  expect(await run.exited()).toEqual({ stdout: "main finished\n", exitCode: 0, signal: null });
  expect(run.stderr()).toMatch(/^panicked at .*detached\.fsh:4:\d+:\nindex out of bounds: the len is 1 but the index is 2\n$/);
});

test("a Router route that panics answers 500 while the other routes keep working", async () => {
  const run = start(await build("routed", `async function main(): Promise<void> throws IoError {
  let app = new Router();
  app.get("/users/:id", async (req) => new Response("user " + req.param("id")));
  app.get("/boom", async (req) => {
    const xs = [req.path];
    return new Response(xs[3]);
  });
  await serve({ port: 0, hostname: "127.0.0.1", onListen: (info: ServeInfo) => console.error("listening " + String(info.port)) }, app.handler());
  console.log("after serve");
}
`));
  const port = Number((await run.line(/^listening \d+$/)).split(" ")[1]);
  for (const path of ["/users/1", "/boom", "/users/2", "/boom", "/users/3"]) {
    const answer = await fetch(`http://127.0.0.1:${port}${path}`);
    expect([answer.status, await answer.text()]).toEqual(path === "/boom" ? [500, ""] : [200, `user ${path.slice(7)}`]);
  }
  run.proc.kill("SIGTERM");
  expect(await run.exited()).toEqual({ stdout: "after serve\n", exitCode: 0, signal: null });
  expect(run.stderr().match(/index out of bounds: the len is 1 but the index is 3/g)?.length).toBe(2);
});
