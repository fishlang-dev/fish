import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each test builds a program with clang, which can take past bun's 5 seconds on a busy runner.
setDefaultTimeout(30_000);

// The std `child_process` module against node's: the same body run by both, output compared.
const tmp = mkdtempSync(join(tmpdir(), "fish-child-process-"));

function compare(name: string, imports: string, body: string, throws = "", nodeBody = body) {
  const program = join(tmp, `${name}.fsh`);
  writeFileSync(program, `${imports}\nfunction main(): void ${throws}{${body}\n}\n`);
  const out = join(tmp, name);
  const built = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out]);
  expect(built.stderr.toString()).toBe("");
  const fish = Bun.spawnSync([out], { cwd: tmp, env: { ...process.env, FISH_LEAKS: "1" } });
  const script = `const cp = require("node:child_process"); const { spawnSync, execFileSync, execSync } = cp; (() => {${nodeBody}\n})();`;
  const node = Bun.spawnSync(["node", "-e", script], { cwd: tmp });
  expect(fish.stderr.toString()).toBe(node.stderr.toString());
  expect(fish.stdout.toString()).toBe(node.stdout.toString());
  return fish.stdout.toString();
}

test("spawnSync gives node's status, signal, output and error", () => {
  const out = compare("spawn", `import { spawnSync } from "node:child_process";`, `
  const r = spawnSync("echo", ["hi", "there"]);
  console.log(r.status, r.signal, new TextDecoder().decode(r.stdout), r.stderr.length, r.pid > 0);
  const k = spawnSync("sh", ["-c", "echo err >&2; exit 3"]);
  console.log(k.status, new TextDecoder().decode(k.stderr));
  const s = spawnSync("sh", ["-c", "kill -TERM $$"]);
  console.log(s.status, s.signal);
  const m = spawnSync("no-such-cmd-x", ["a"]);
  console.log(m.status, m.error?.message, m.error?.code, m.error?.syscall, m.error?.path);
  const c = spawnSync("cat", [], { input: "fed in" });
  console.log(new TextDecoder().decode(c.stdout));
  const w = spawnSync("pwd", [], { cwd: "/" });
  console.log(new TextDecoder().decode(w.stdout));
  const big = spawnSync("sh", ["-c", "head -c 1000000 /dev/zero; head -c 50000 /dev/zero >&2"]);
  console.log(big.stdout.length, big.stderr.length);
  const early = spawnSync("true", [], { input: "x".repeat(1000000) });
  console.log(early.status);`);
  expect(out).toContain("SIGTERM");
});

test("spawnSync with a utf8 encoding gives text, keeping its other options", () => {
  compare("text", `import * as cp from "child_process";`, `
  const r = cp.spawnSync("sh", ["-c", "printf 'héllo'; printf 'wörld' >&2"], { encoding: "utf8" });
  console.log(r.stdout, r.stderr, r.stdout.length);
  const c = cp.spawnSync("cat", [], { input: "été", cwd: "/", encoding: "utf-8" });
  console.log(c.stdout, c.status);`);
});

test("spawnSync's encoding must be a literal UTF-8", () => {
  for (const [options, message] of [
    [`{ encoding: e }`, `'spawnSync' takes its encoding as a literal, like { encoding: "utf8" }`],
    [`{ encoding: "latin1" }`, `'spawnSync' knows the "utf8" encoding so far, not "latin1"`],
  ]) {
    const program = join(tmp, "bad.fsh");
    writeFileSync(program, `import { spawnSync } from "node:child_process";\nfunction main(): void {\n  const e = "utf8";\n  spawnSync("true", [], ${options});\n}\n`);
    const built = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", join(tmp, "bad")]);
    expect(built.stderr.toString()).toContain(message!);
  }
});

// Node throws one kind of error for both failures; Fish an IoError when the command can't start and
// an ExecError when it fails.
const failing = [`execFileSync("sh", ["-c", "echo partial; echo bad >&2; exit 4"])`, `execSync("kill -TERM $$")`, `execFileSync("no-such-cmd-x")`];

test("execFileSync and execSync give stdout, or node's errors", () => {
  const body = `
  console.log(new TextDecoder().decode(execFileSync("echo", ["a", "b"])));
  console.log(execFileSync("sh", ["-c", "printf out; printf warned >&2"], { encoding: "utf8" }));
  console.log(execSync("echo $((1+2))", { encoding: "utf8" }), execSync("cat", { input: "x" }).length);`;
  const fish = failing.map((call) => `
  try {
    ${call};
  } catch (e) {
    if (e instanceof ExecError) console.log(JSON.stringify(e.message), e.status, e.signal, e.stdout.length, e.stderr.length);
    else console.log(e.message, e.code, e.syscall, e.path);
  }`);
  const node = failing.map((call) => `
  try {
    ${call};
  } catch (e) {
    if (e.code === undefined) console.log(JSON.stringify(e.message), e.status, e.signal, e.stdout.length, e.stderr.length);
    else console.log(e.message, e.code, e.syscall, e.path);
  }`);
  compare("exec", `import { execFileSync, execSync, ExecError } from "node:child_process";`, body + fish.join(""), "throws IoError | ExecError ", body + node.join(""));
});
