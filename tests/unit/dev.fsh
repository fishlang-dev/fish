// `fishc dev`: the state shapes it compares, and the command itself run as the native fishc in the
// background, a client holding one connection open while a handler changes under it. A Fish
// child's output comes whole once it ends, so fishc dev's stderr is written to a file and read as
// it grows. Each test kills what it started before it checks anything.
import type { Subprocess } from "bun";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stateShapes } from "../../src/dev.fsh";
import { fishcPath, removed, same, scratch } from "./support.fsh";

test("the state shapes are the IR's marks, each once, sorted", () => {
  const ir = "define void @f() {\n  ret void\n}\n; fsh.devstate shared<B> { b: i64 }\n; fsh.devstate shared<A>\n; fsh.devstate shared<B> { b: i64 }\n";
  same(stateShapes(ir), "shared<A>\nshared<B> { b: i64 }", "the shapes");
  same(stateShapes("define void @g() {\n  ret void\n}\n"), "", "a build that keeps no state");
});

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

function readOr(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  } catch (_e) {
    return "";
  }
}

// A server counting its requests in its state, answering with `word` and the count. With `named`,
// the state's type has a field more, so its shape differs.
function program(port: i64, word: string, named: boolean): string {
  const state = named ? "shared<{ hits: Atomic<i64>; name: string }>" : "shared<{ hits: Atomic<i64> }>";
  const initial = named ? `shared({ hits: new Atomic(0), name: "n" })` : "shared({ hits: new Atomic(0) })";
  return `type App = ${state};
async function main(): Promise<void> throws IoError {
  const initial: App = ${initial};
  let app = new Router().state(initial);
  app.get("/", async (_req, state) => new Response("${word} " + String(state.hits.add(1) + 1) + "\\n"));
  await serve({ port: ${port}, hostname: "127.0.0.1" }, app.handler());
}
`;
}

// Waits until the stderr in `err` from `from` on holds `needle`, giving why not if it never does.
async function until(err: string, needle: string, from: usize = 0): Promise<string> {
  const deadline = performance.now() + 120000;
  while (true) {
    const seen = readOr(err);
    if (seen.slice(from as i64).includes(needle)) return "";
    if (performance.now() > deadline) return `never saw '${needle}' in:\n${seen}`;
    await sleep(100);
  }
}

// Sends a GET on `socket` and reads until the answer's body holds `want`, giving why not if it
// never does.
async function asked(socket: Ref<TcpStream>, want: string): Promise<string> {
  try {
    await socket.write(new TextEncoder().encode("GET / HTTP/1.1\r\nHost: dev.test\r\n\r\n"));
    const signal = AbortSignal.timeout(20000);
    let got = "";
    while (!got.includes(want)) {
      const more = await socket.read(65536, signal.clone());
      if (more.length === 0) return `the connection ended before '${want}'; read:\n${got}`;
      got += new TextDecoder().decode(more);
    }
    return "";
  } catch (e) {
    return `no '${want}' on the connection: ${e.message}`;
  }
}

function spawned(cmd: string[], cwd: string): Subprocess | null {
  try {
    return Bun.spawn(cmd.clone(), { cwd, stdout: "ignore", stderr: "ignore" });
  } catch (e) {
    assert(false, `can't run ${cmd[0]}: ${e.message}`);
    return null;
  }
}

async function reloads(err: string, d: string, port: i64): Promise<string> throws IoError | AbortError {
  let f = await until(err, "[fishc] serving on http://127.0.0.1:");
  if (f !== "") return f;
  const socket = await TcpStream.connect("127.0.0.1", port);
  f = await asked(socket, "one 1\n");
  if (f !== "") return f;
  let at = readOr(err).length;
  write(join(d, "main.fsh"), program(port, "two", false));
  f = await until(err, "[fishc] reloaded the handlers; connections and state were kept\n", at);
  if (f !== "") return f;
  if (!readOr(err).slice(at as i64).includes("[fishc] reloading: main.fsh changed\n")) return `no reloading line:\n${readOr(err)}`;
  // The same connection, now answered by the new handler with the count the first load's state kept.
  f = await asked(socket, "two 2\n");
  if (f !== "") return f;
  at = readOr(err).length;
  write(join(d, "main.fsh"), program(port, "oops", false).replace("String(state.hits.add(1) + 1)", "state.hits.missing()"));
  f = await until(err, "[fishc] the server keeps the handlers that built last; waiting for changes\n", at);
  if (f !== "") return f;
  f = await asked(socket, "two 3\n");
  if (f !== "") return f;
  at = readOr(err).length;
  write(join(d, "main.fsh"), program(port, "three", true));
  f = await until(err, "[fishc] the state's type changed, so the server restarts; its connections and state are dropped\n", at);
  if (f !== "") return f;
  f = await until(err, "[fishc] serving on http://127.0.0.1:", at);
  if (f !== "") return f;
  const fresh = await TcpStream.connect("127.0.0.1", port);
  return await asked(fresh, "three 1\n");
}

test("fishc dev swaps a changed handler in on a kept connection, keeps its state, and restarts when the state's type changes", async () => {
  const root = scratch("fish-dev-");
  const port: i64 = 40000 + Date.now() % 20000;
  write(join(root, "main.fsh"), program(port, "one", false));
  const err = join(root, "dev.err");
  write(err, "");
  const child = spawned(["sh", "-c", `exec "$0" dev main.fsh 2> ${JSON.stringify(err)}`, fishcPath()], root)!;
  let failure = "";
  try {
    failure = await reloads(err, root, port);
  } catch (e) {
    failure = `a client failed: ${e.message}\n${readOr(err)}`;
  }
  child.kill("SIGTERM");
  const code = await child.exited;
  spawnSync("pkill", ["-9", "-f", root]);
  assert(failure === "", failure);
  assert(code === 143, `fishc dev exited with ${code}`);
  removed(root);
}, { timeout: 600_000 });
