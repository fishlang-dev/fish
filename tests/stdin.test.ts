import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Standard input that a `// stdin:` directive can't give: written in timed pieces, or a regular
// file rather than a pipe. Each test builds its program with clang, which can be slow on a busy
// machine.
setDefaultTimeout(60_000);

const tmp = mkdtempSync(join(tmpdir(), "fish-stdin-"));

async function build(name: string, src: string): Promise<string> {
  const program = join(tmp, `${name}.fsh`);
  writeFileSync(program, src);
  const out = join(tmp, name);
  const built = Bun.spawn(["bun", join(import.meta.dir, "..", "src", "main.ts"), "build", program, "-o", out], { stderr: "pipe" });
  expect(await new Response(built.stderr).text()).toBe("");
  expect(await built.exited).toBe(0);
  return out;
}

const ECHO = `async function main() {
  for await (const line of stdin.lines()) console.log(\`\${line.length} \${line.slice(0, 12)}\`);
  console.log("end");
}
`;

// Runs a program, writing each piece to its stdin with a pause before the next, then closing it.
async function piped(binary: string, pieces: (string | Uint8Array)[], pause = 20) {
  const proc = Bun.spawn([binary], { env: { ...process.env, FISH_LEAKS: "1" }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  for (const piece of pieces) {
    proc.stdin.write(piece);
    await proc.stdin.flush();
    await Bun.sleep(pause);
  }
  await proc.stdin.end();
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  expect(await proc.exited).toBe(0);
  expect(stderr).not.toContain("fish: leaked");
  return stdout;
}

test("a line longer than many reads arrives whole", async () => {
  const binary = await build("long", ECHO);
  const pieces = Array.from({ length: 40 }, () => "x".repeat(10_000));
  expect(await piped(binary, [...pieces, "\nshort"], 2)).toBe(`400000 ${"x".repeat(12)}\n5 short\nend\n`);
});

test("characters split across reads decode whole", async () => {
  const binary = await build("split", ECHO);
  const bytes = new TextEncoder().encode("é日本👍🏽\n");
  // Every byte its own write, so each multi-byte character is split between reads.
  const pieces = [...bytes].map((b) => new Uint8Array([b]));
  expect(await piped(binary, pieces, 5)).toBe("7 é日本👍🏽\nend\n");
});

test("other tasks run while a read waits on a slow pipe", async () => {
  const binary = await build("slow", `async function main() {
  const reader = spawn(readLine());
  for (let i = 1; i <= 3; i++) {
    await sleep(30);
    console.error(\`tick \${i}\`);
  }
  const line = await reader;
  console.log(\`got \${line ?? "none"}\`);
}
`);
  const proc = Bun.spawn([binary], { env: { ...process.env, FISH_LEAKS: "1" }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  // Nothing is written until every tick has been printed, so the ticks ran while the read waited.
  const reader = proc.stderr.getReader();
  let seen = "";
  const deadline = Date.now() + 10_000;
  while (!seen.includes("tick 3\n")) {
    if (Date.now() > deadline) throw new Error(`no ticks while the read waited: ${JSON.stringify(seen)}`);
    const { value, done } = await reader.read();
    if (done) break;
    seen += new TextDecoder().decode(value);
  }
  expect(seen).toBe("tick 1\ntick 2\ntick 3\n");
  proc.stdin.write("hello\n");
  await proc.stdin.end();
  expect(await new Response(proc.stdout).text()).toBe("got hello\n");
  expect(await proc.exited).toBe(0);
});

test("a file redirected to stdin reads like a pipe", async () => {
  const binary = await build("file", ECHO);
  const input = join(tmp, "input.txt");
  writeFileSync(input, "first\r\nsecond\nthird");
  // The shell's redirect gives the program the file itself as stdin, not a pipe.
  const proc = Bun.spawn(["sh", "-c", 'exec "$0" < "$1"', binary, input], { stdout: "pipe", stderr: "pipe" });
  expect(await new Response(proc.stdout).text()).toBe("5 first\n6 second\n5 third\nend\n");
  expect(await proc.exited).toBe(0);
});
