import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each test builds a program with clang, which can take past bun's 5 seconds on a busy runner.
setDefaultTimeout(30_000);

// The std `child_process` module against node's: the same body run by both, output compared.
const tmp = mkdtempSync(join(tmpdir(), "fish-child-process-"));

function compare(name: string, imports: string, body: string, throws = "") {
  const program = join(tmp, `${name}.fsh`);
  writeFileSync(program, `${imports}\nfunction main(): void ${throws}{${body}\n}\n`);
  const out = join(tmp, name);
  const built = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out]);
  expect(built.stderr.toString()).toBe("");
  const fish = Bun.spawnSync([out], { cwd: tmp, env: { ...process.env, FISH_LEAKS: "1" } });
  const script = `const { spawnSync, execFileSync, execSync } = require("node:child_process"); (() => {${body}\n})();`;
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
