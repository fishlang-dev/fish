import { expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each test builds a program with clang, which can take past bun's 5 seconds on a busy runner.
setDefaultTimeout(30_000);

// Fish's subset of Bun's global against Bun itself: the same body run by both in directories of
// their own, output compared, with absolute paths printed as `<dir>`.
const tmp = mkdtempSync(join(tmpdir(), "fish-bun-"));

function compare(name: string, body: string, stdin = "", setup: (dir: string) => void = () => {}) {
  const dirs = [mkdtempSync(join(tmp, `${name}-fish-`)), mkdtempSync(join(tmp, `${name}-bun-`))];
  dirs.forEach(setup);
  const program = join(tmp, `${name}.fsh`);
  writeFileSync(program, `async function main(): Promise<void> throws IoError {${body}\n}\n`);
  const out = join(tmp, name);
  const built = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out]);
  expect(built.stderr.toString()).toBe("");
  const input = new TextEncoder().encode(stdin);
  const fish = Bun.spawnSync([out], { cwd: dirs[0], stdin: input, env: { ...process.env, FISH_LEAKS: "1" } });
  const script = join(tmp, `${name}.ts`);
  writeFileSync(script, `await (async () => {${body}\n})();\n`);
  const bun = Bun.spawnSync(["bun", script], { cwd: dirs[1], stdin: input });
  const shown = (out: Buffer, dir: string) => out.toString().replaceAll(realpathSync(dir), "<dir>");
  expect(shown(fish.stderr, dirs[0]!)).toBe(shown(bun.stderr, dirs[1]!));
  expect(shown(fish.stdout, dirs[0]!)).toBe(shown(bun.stdout, dirs[1]!));
  return shown(fish.stdout, dirs[0]!);
}

test("spawnSync gives Bun's exit code, signal, output and errors", () => {
  const out = compare("spawn", `
  const d = new TextDecoder();
  const r = Bun.spawnSync(["sh", "-c", "echo out; echo err >&2; exit 3"]);
  console.log(r.exitCode, r.signalCode ?? "none", r.success, d.decode(r.stdout), d.decode(r.stderr), r.pid > 0);
  const c = Bun.spawnSync(["cat"]);
  console.log(JSON.stringify(d.decode(c.stdout)), c.exitCode);
  const fed = Bun.spawnSync(["cat"], { stdin: new TextEncoder().encode("fed in") });
  console.log(d.decode(fed.stdout));
  const k = Bun.spawnSync(["sh", "-c", "kill -TERM $$"]);
  console.log(k.exitCode, k.signalCode, k.success);
  console.log("before the child");
  const inherited = Bun.spawnSync(["sh", "-c", "echo inherited; echo to stderr >&2"], { stdout: "inherit", stderr: "inherit" });
  console.log(inherited.exitCode);
  const quiet = Bun.spawnSync(["sh", "-c", "echo hidden"], { stdout: "ignore" });
  console.log(quiet.success);
  const w = Bun.spawnSync(["pwd"], { cwd: "/" });
  console.log(d.decode(w.stdout));
  const e = Bun.spawnSync(["sh", "-c", "echo $FOO-$HOME-"], { env: { FOO: "bar" } });
  console.log(d.decode(e.stdout));
  const big = Bun.spawnSync(["sh", "-c", "head -c 1000000 /dev/zero; head -c 50000 /dev/zero >&2"]);
  console.log(big.stdout.length, big.stderr.length);
  const failing = (cmd: string[]) => {
    try {
      Bun.spawnSync(cmd);
    } catch (e) {
      console.log(e.message, e.path ?? "");
    }
  };
  failing(["no-such-cmd-x"]);
  failing(["/no/such"]);
  failing([]);
  try {
    Bun.spawnSync(["no-such-cmd-x"]);
  } catch (e) {
    console.log(e.code);
  }
  try {
    Bun.spawnSync(["echo"], { cwd: "/nope" });
  } catch (e) {
    console.log(e.message, e.code, e.syscall, e.path);
  }`);
  expect(out).toContain("inherited\n");
});

test("which finds executables on PATH, or by a path with a slash", () => {
  compare("which", `
  console.log(Bun.which("sh"), Bun.which("no-such-x"), Bun.which("/bin/sh"), Bun.which(""), Bun.which("/tmp"));
  console.log(Bun.which("./bin/tool"), Bun.which("bin/tool"), Bun.which("plain"), Bun.which("./plain"));`, "", (dir) => {
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin", "tool"), "#!/bin/sh\n");
    chmodSync(join(dir, "bin", "tool"), 0o755);
    writeFileSync(join(dir, "plain"), "");
  });
});

test("file, write, stdin, env, argv and the sleeps", () => {
  compare("files", `
  const n = await Bun.write("sub/dir/x.txt", "héllo");
  const text = await Bun.file("sub/dir/x.txt").text();
  const bytes = await Bun.file("sub/dir/x.txt").bytes();
  const there = await Bun.file("sub/dir/x.txt").exists();
  const missing = await Bun.file("nope").exists();
  const directory = await Bun.file("sub").exists();
  console.log(n, text, bytes.length, there, missing, directory);
  const m = await Bun.write("b.bin", new TextEncoder().encode("abc"));
  const again = await Bun.file("b.bin").text();
  console.log(m, again);
  try {
    const _t = await Bun.file("nope").text();
  } catch (e) {
    console.log(e.message, e.code, e.syscall, e.path);
  }
  const input = await Bun.stdin.text();
  console.log(JSON.stringify(input));
  console.log(Bun.env.HOME === process.env.HOME, Bun.env.FISH_NOT_SET_ANYWHERE ?? "unset", Bun.argv.length);
  const start = Date.now();
  Bun.sleepSync(20);
  await Bun.sleep(20);
  console.log(Date.now() - start >= 40);`, "from stdin\n");
});

// Bun.serve gives a Server at once and Fish's is awaited, so each side has its own program: both
// serve the same handler and print what a request through fetch got back.
test("serve answers through fetch as Bun's does", async () => {
  const free = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = free.port;
  free.stop(true);
  const handler = `async (req) => {
    const sent = await req.text();
    let headers = new Headers();
    headers.set("x-from", "fetch");
    return new Response("hi " + req.method + " " + req.url + " " + sent, { status: 201, headers });
  }`;
  const asked = `const res = await fetch("http://127.0.0.1:${port}/a/b?c=d", { method: "POST", body: "sent" });
  const body = await res.text();
  console.log(res.status, body, res.headers.get("x-from"));`;
  const program = join(tmp, "serve.fsh");
  writeFileSync(program, `async function main(): Promise<void> throws IoError | AbortError {
  const stop = new AbortController();
  const server = spawn(Bun.serve({ port: ${port}, hostname: "127.0.0.1", signal: stop.signal.clone(), fetch: ${handler} }));
  await sleep(200);
  ${asked}
  stop.abort();
  await server;
}
`);
  const out = join(tmp, "serve");
  const built = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out]);
  expect(built.stderr.toString()).toBe("");
  const fish = Bun.spawnSync([out], { env: { ...process.env, FISH_LEAKS: "1" } });
  const script = join(tmp, "serve.ts");
  writeFileSync(script, `const server = Bun.serve({ port: ${port}, hostname: "127.0.0.1", fetch: ${handler} });\n${asked}\nserver.stop();\n`);
  const bun = Bun.spawnSync(["bun", script]);
  expect(fish.stderr.toString()).toBe("");
  expect(bun.stderr.toString()).toBe("");
  expect(fish.stdout.toString()).toBe(bun.stdout.toString());
  expect(fish.stdout.toString()).toBe(`201 hi POST http://127.0.0.1:${port}/a/b?c=d sent fetch\n`);
});
