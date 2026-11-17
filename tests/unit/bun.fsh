// Ports tests/bun.test.ts: Fish's subset of Bun's global against Bun itself: the same body run by
// both in directories of their own, output compared, with absolute paths printed as `<dir>`.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { built, freePort, removed, same, scratch, text } from "./support.fsh";

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

function made(path: string): string {
  try {
    mkdirSync(path);
  } catch (e) {
    assert(false, `can't make ${path}: ${e.message}`);
  }
  return path;
}

// Bun's own executable, the reference the body runs under.
function bunPath(): string {
  return text(spawnSync("sh", ["-c", "command -v bun"]).stdout).trim();
}

// Runs `body` as a Fish program and under Bun, each in a directory of its own made ready by the
// shell commands `setup`, with `stdin` fed in and `env` set; gives Fish's stdout once both runs'
// stderr and stdout match.
function compare(tmp: string, name: string, body: string, stdin: string, setup: string, env: string[]): string {
  const dirs = [made(join(tmp, `${name}-fish`)), made(join(tmp, `${name}-bun`))];
  if (setup !== "") {
    for (const dir of dirs) {
      const done = spawnSync("sh", ["-c", setup], { cwd: dir });
      same(text(done.stderr), "", `setting up ${dir}`);
    }
  }
  const out = built(tmp, name, `async function main(): Promise<void> throws IoError {${body}\n}\n`);
  const fish = spawnSync("env", [...env, "FISH_LEAKS=1", out], { cwd: dirs[0], input: stdin });
  const script = join(tmp, `${name}.ts`);
  write(script, `await (async () => {${body}\n})();\n`);
  const bun = spawnSync("env", [...env, bunPath(), script], { cwd: dirs[1], input: stdin });
  same(text(fish.stderr).replaceAll(dirs[0], "<dir>"), text(bun.stderr).replaceAll(dirs[1], "<dir>"), `${name}'s stderr`);
  same(text(fish.stdout).replaceAll(dirs[0], "<dir>"), text(bun.stdout).replaceAll(dirs[1], "<dir>"), `${name}'s output`);
  return text(fish.stdout).replaceAll(dirs[0], "<dir>");
}

test("spawnSync gives Bun's exit code, signal, output and errors", () => {
  const tmp = scratch("fish-bun-");
  const out = compare(tmp, "spawn", `
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
  }`, "", "", []);
  assert(out.includes("inherited\n"), `no inherited output in:\n${out}`);
  removed(tmp);
});

test("spawn gives a running child Bun's exit code, signal and output", () => {
  const tmp = scratch("fish-bun-");
  compare(tmp, "spawn-async", `
  const c = Bun.spawn(["sleep", "5"]);
  c.kill();
  const killed = await c.exited;
  console.log(killed, c.exitCode, c.signalCode, c.killed, c.pid > 0);
  const d = Bun.spawn(["sh", "-c", "echo out; echo err >&2; exit 3"], { stdout: "pipe", stderr: "pipe" });
  const out = new Response(d.stdout);
  const err = new Response(d.stderr);
  const [code, text, errors] = await Promise.all([d.exited, out.text(), err.text()]);
  const again = await d.exited;
  console.log(code, d.exitCode, d.signalCode, text, errors, again);
  const fed = Bun.spawn(["cat"], { stdin: new TextEncoder().encode("fed in") });
  const fedText = new Response(fed.stdout);
  const fedOut = await fedText.text();
  console.log(fedOut);
  const k = Bun.spawn(["sleep", "5"]);
  k.kill("SIGKILL");
  const kc = await k.exited;
  console.log(kc, k.signalCode, k.killed);
  const big = Bun.spawn(["sh", "-c", "head -c 300000 /dev/zero"]);
  const bigText = new Response(big.stdout);
  const [bigCode, bigOut] = await Promise.all([big.exited, bigText.text()]);
  console.log(bigCode, bigOut.length);
  console.log("before the child");
  const inherited = Bun.spawn(["sh", "-c", "echo inherited"], { stdio: ["inherit", "inherit", "inherit"] });
  const inheritedCode = await inherited.exited;
  console.log(inheritedCode);
  const w = Bun.spawn(["pwd"], { cwd: "/" });
  const where = new Response(w.stdout);
  const whereText = await where.text();
  console.log(whereText);
  try {
    Bun.spawn(["/no/such"]);
  } catch (e) {
    console.log(e.message);
  }`, "", "", []);
  removed(tmp);
});

test("which finds executables on PATH, or by a path with a slash", () => {
  const tmp = scratch("fish-bun-");
  compare(tmp, "which", `
  console.log(Bun.which("sh"), Bun.which("no-such-x"), Bun.which("/bin/sh"), Bun.which(""), Bun.which("/tmp"));
  console.log(Bun.which("./bin/tool"), Bun.which("bin/tool"), Bun.which("plain"), Bun.which("./plain"));`, "", `mkdir bin && printf '#!/bin/sh\\n' > bin/tool && chmod 755 bin/tool && : > plain`, []);
  removed(tmp);
});

test("a command is looked for on env's PATH when given, relative entries from the working directory", () => {
  const tmp = scratch("fish-bun-");
  const path = process.env.PATH ?? "";
  const out = compare(tmp, "path", `
  const d = new TextDecoder();
  const r = Bun.spawnSync(["tool", "x"], { env: { PATH: "bin" } });
  console.log(d.decode(r.stdout));
  console.log(Bun.which("tool"));
  const bad = (cmd: string[], env: Record<string, string>) => {
    try {
      Bun.spawnSync(cmd, { env });
    } catch (e) {
      console.log(e.message.split(". Received")[0], e.code);
    }
  };
  bad(["sh", "-c", "a\\0b"], {});
  bad(["s\\0h"], {});
  bad(["sh"], { A: "x\\0y" });`, "", `mkdir bin && printf '#!/bin/sh\\necho "ran $1"\\n' > bin/tool && chmod 755 bin/tool`, [`PATH=bin::${path}`]);
  same(out, "ran x\n\n<dir>/bin/tool\nThe argument 'args[2]' must be a string without null bytes ERR_INVALID_ARG_VALUE\nThe argument 'args[0]' must be a string without null bytes ERR_INVALID_ARG_VALUE\nThe property 'options.env['A']' must be a string without null bytes ERR_INVALID_ARG_VALUE\n", "the output");
  removed(tmp);
});

test("file, write, stdin, env, argv and the sleeps", () => {
  const tmp = scratch("fish-bun-");
  compare(tmp, "files", `
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
  console.log(Date.now() - start >= 40);`, "from stdin\n", "", []);
  removed(tmp);
});

// Bun.serve gives a Server at once and Fish's is awaited, so each side has its own program: both
// serve the same handler and print what a request through fetch got back.
test("serve answers through fetch as Bun's does", () => {
  const tmp = scratch("fish-bun-");
  const port = freePort();
  const handler = `async (req) => {
    const sent = await req.text();
    let headers = new Headers();
    headers.set("x-from", "fetch");
    return new Response("hi " + req.method + " " + req.url + " " + sent, { status: 201, headers });
  }`;
  const asked = `const res = await fetch("http://127.0.0.1:${port}/a/b?c=d", { method: "POST", body: "sent" });
  const body = await res.text();
  console.log(res.status, body, res.headers.get("x-from"));`;
  const out = built(tmp, "serve", `async function main(): Promise<void> throws IoError | AbortError {
  const stop = new AbortController();
  const server = spawn(Bun.serve({ port: ${port}, hostname: "127.0.0.1", signal: stop.signal.clone(), fetch: ${handler} }));
  await sleep(200);
  ${asked}
  stop.abort();
  await server;
}
`);
  const fish = spawnSync("env", ["FISH_LEAKS=1", out]);
  const script = join(tmp, "serve.ts");
  write(script, `const server = Bun.serve({ port: ${port}, hostname: "127.0.0.1", fetch: ${handler} });\n${asked}\nserver.stop();\n`);
  const bun = spawnSync(bunPath(), [script]);
  same(text(fish.stderr), "", "Fish's stderr");
  same(text(bun.stderr), "", "Bun's stderr");
  same(text(fish.stdout), text(bun.stdout), "the output");
  same(text(fish.stdout), `201 hi POST http://127.0.0.1:${port}/a/b?c=d sent fetch\n`, "Fish's output");
  removed(tmp);
});
