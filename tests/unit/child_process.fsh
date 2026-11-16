// Ports tests/child_process.test.ts: the std `child_process` module against node's: the same body
// run by both, output compared.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { built, fishc, removed, same, scratch, text } from "./support.fsh";

function compare(name: string, imports: string, body: string, throws: string, nodeBody: string): string {
  const tmp = scratch("fish-child-process-");
  const out = built(tmp, name, `${imports}\nfunction main(): void ${throws}{${body}\n}\n`);
  const fish = spawnSync("env", ["FISH_LEAKS=1", out], { cwd: tmp });
  const script = `const cp = require("node:child_process"); const { spawnSync, execFileSync, execSync } = cp; (() => {${nodeBody}\n})();`;
  const node = spawnSync("node", ["-e", script], { cwd: tmp });
  same(text(fish.stderr), text(node.stderr), `${name}'s stderr`);
  same(text(fish.stdout), text(node.stdout), `${name}'s output`);
  removed(tmp);
  return text(fish.stdout);
}

// The build's stderr for a program of `body` in main.
function refused(name: string, body: string): string {
  const tmp = scratch("fish-child-process-");
  const program = join(tmp, `${name}.fsh`);
  try {
    writeFileSync(program, `import { spawnSync } from "node:child_process";\nfunction main(): void {\n${body}\n}\n`);
  } catch (e) {
    assert(false, e.message);
  }
  const err = fishc(tmp, ["build", program, "-o", join(tmp, name)]).err;
  removed(tmp);
  return err;
}

function spawnBody(): string {
  return `
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
  console.log(early.status);`;
}

test("spawnSync gives node's status, signal, output and error", () => {
  const body = spawnBody();
  const out = compare("spawn", `import { spawnSync } from "node:child_process";`, body, "", body);
  assert(out.includes("SIGTERM"), `no SIGTERM in:\n${out}`);
});

function textBody(): string {
  return `
  const r = cp.spawnSync("sh", ["-c", "printf 'héllo'; printf 'wörld' >&2"], { encoding: "utf8" });
  console.log(r.stdout, r.stderr, r.stdout.length);
  const c = cp.spawnSync("cat", [], { input: "été", cwd: "/", encoding: "utf-8" });
  console.log(c.stdout, c.status);`;
}

test("spawnSync with a utf8 encoding gives text, keeping its other options", () => {
  const body = textBody();
  compare("text", `import * as cp from "child_process";`, body, "", body);
});

test("spawnSync's encoding must be a literal UTF-8", () => {
  const cases: [string, string][] = [
    [`{ encoding: e }`, `'spawnSync' takes its encoding as a literal, like { encoding: "utf8" }`],
    [`{ encoding: "latin1" }`, `'spawnSync' knows the "utf8" encoding so far, not "latin1"`],
  ];
  for (const [options, message] of cases) {
    const err = refused("bad", `  const e = "utf8";\n  spawnSync("true", [], ${options});`);
    assert(err.includes(message), `${options}: expected ${message} in:\n${err}`);
  }
});

// Node throws one kind of error for both failures; Fish an IoError when the command can't start and
// an ExecError when it fails.
test("execFileSync and execSync give stdout, or node's errors", () => {
  const failing = [`execFileSync("sh", ["-c", "echo partial; echo bad >&2; exit 4"])`, `execSync("kill -TERM $$")`, `execFileSync("no-such-cmd-x")`];
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

function moreBody(): string {
  return `
  const c = spawnSync("cat", [], { input: new TextEncoder().encode("bytes in"), encoding: "utf8" });
  console.log(c.stdout);
  const m = spawnSync("pwd", [], { cwd: "/no/such/dir" });
  console.log(m.status, m.error?.message, m.error?.code, m.error?.syscall);
  console.log(spawnSync("echo", ["x"], { encoding: "buffer" }).stdout.length, spawnSync("echo", ["y"], { encoding: null }).stdout.length);`;
}

test("spawnSync takes byte input, a missing cwd and Node's bytes encodings as node does", () => {
  const body = moreBody();
  compare("more", `import { spawnSync } from "node:child_process";`, body, "", body);
});

test("a child gets its input with this process's stdin closed", () => {
  const tmp = scratch("fish-child-process-");
  const out = built(tmp, "closed", `import { spawnSync } from "node:child_process";\nfunction main(): void {\n  const r = spawnSync("cat", [], { input: "fed", encoding: "utf8" });\n  console.log(r.stdout, r.status);\n}\n`);
  const run = spawnSync("sh", ["-c", `"$0" <&-`, out]);
  same(text(run.stdout), "fed 0\n", "the output");
  removed(tmp);
});

test("an encoding held anywhere but the call's literal is refused", () => {
  const cases: [string, string][] = [
    [`const o = { encoding: "utf8" };\n  spawnSync("true", [], o);`, `is not assignable`],
    [`const encoding = "utf8";\n  spawnSync("true", [], { encoding });`, `'spawnSync' takes its encoding as a literal`],
  ];
  for (const [code, message] of cases) {
    const err = refused("held", `  ${code}`);
    assert(err.includes(message), `${code}: expected ${message} in:\n${err}`);
  }
});
