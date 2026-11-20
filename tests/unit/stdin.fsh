// Standard input that a `// stdin:` directive can't give, written in timed
// pieces by a Node child process feeding the program's stdin through a pipe, or a regular file
// rather than a pipe.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { built, removed, same, scratch, text } from "./support.fsh";

function echo(): string {
  return `async function main() {
  for await (const line of stdin.lines()) console.log(\`\${line.length} \${line.slice(0, 12)}\`);
  console.log("end");
}
`;
}

// Writes each piece of the JSON array of byte arrays its first argument names to stdout, synchronously
// so each is its own write, pausing its second argument's milliseconds after each.
function feeder(): string {
  return `const fs = require("node:fs");
const pieces = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const pause = Number(process.argv[3]);
const wait = new Int32Array(new SharedArrayBuffer(4));
for (const p of pieces) {
  fs.writeSync(1, Buffer.from(p));
  Atomics.wait(wait, 0, 0, pause);
}
`;
}

function write(path: string, contents: string): void {
  try {
    writeFileSync(path, contents);
  } catch (e) {
    assert(false, `can't write ${path}: ${e.message}`);
  }
}

// Runs `binary` with each piece written to its stdin with a pause before the next, then closed,
// giving its stdout; it must exit with 0 and report no leaks.
function piped(dir: string, binary: string, pieces: Ref<u8[][]>, pause: i64): string {
  const feed = join(dir, "feed.cjs");
  write(feed, feeder());
  const input = join(dir, "pieces.json");
  write(input, JSON.stringify(pieces));
  const run = spawnSync("sh", ["-c", `node "$1" "$2" "$3" | env FISH_LEAKS=1 "$4"`, "sh", feed, input, `${pause}`, binary]);
  const err = text(run.stderr);
  assert(run.status === 0, `exited with ${run.status ?? -1}: ${err}`);
  assert(!err.includes("fish: leaked"), `leaked: ${err}`);
  return text(run.stdout);
}

function utf8(s: string): u8[] {
  return new TextEncoder().encode(s);
}

test("a line longer than many reads arrives whole", () => {
  const tmp = scratch("fish-stdin-");
  const binary = built(tmp, "long", echo());
  let pieces: u8[][] = [];
  for (let i = 0; i < 40; i++) pieces.push(utf8("x".repeat(10000)));
  pieces.push(utf8("\nshort"));
  same(piped(tmp, binary, pieces, 2), `400000 ${"x".repeat(12)}\n5 short\nend\n`, "the output");
  removed(tmp);
}, { timeout: 60_000 });

test("characters split across reads decode whole", () => {
  const tmp = scratch("fish-stdin-");
  const binary = built(tmp, "split", echo());
  // Every byte its own write, so each multi-byte character is split between reads.
  let pieces: u8[][] = [];
  for (const b of utf8("é日本👍🏽\n")) pieces.push([b]);
  same(piped(tmp, binary, pieces, 5), "7 é日本👍🏽\nend\n", "the output");
  removed(tmp);
}, { timeout: 60_000 });

// Nothing is written until every tick has been printed, so the ticks ran while the read waited: the
// writer waits for the third tick in the program's stderr, then writes the line.
test("other tasks run while a read waits on a slow pipe", () => {
  const tmp = scratch("fish-stdin-");
  const binary = built(tmp, "slow", `async function main() {
  const reader = spawn(readLine());
  for (let i = 1; i <= 3; i++) {
    await sleep(30);
    console.error(\`tick \${i}\`);
  }
  const line = await reader;
  console.log(\`got \${line ?? "none"}\`);
}
`);
  const err = join(tmp, "stderr");
  const script = `{ n=0; while ! grep -qx "tick 3" "$1" 2> /dev/null; do n=$((n + 1)); if [ $n -gt 200 ]; then break; fi; sleep 0.05; done; printf 'hello\\n'; } | env FISH_LEAKS=1 "$2" 2> "$1"`;
  const run = spawnSync("sh", ["-c", script, "sh", err, binary]);
  let seen = "";
  try {
    seen = readFileSync(err, "utf8");
  } catch (e) {
    assert(false, `can't read the program's stderr: ${e.message}`);
  }
  same(seen, "tick 1\ntick 2\ntick 3\n", "the ticks before the line was written");
  same(text(run.stdout), "got hello\n", "the output");
  assert(run.status === 0, `exited with ${run.status ?? -1}`);
  removed(tmp);
}, { timeout: 60_000 });

test("a file redirected to stdin reads like a pipe", () => {
  const tmp = scratch("fish-stdin-");
  const binary = built(tmp, "file", echo());
  const input = join(tmp, "input.txt");
  write(input, "first\r\nsecond\nthird");
  // The shell's redirect gives the program the file itself as stdin, not a pipe.
  const run = spawnSync("sh", ["-c", `exec "$0" < "$1"`, binary, input]);
  same(text(run.stdout), "5 first\n6 second\n5 third\nend\n", "the output");
  assert(run.status === 0, `exited with ${run.status ?? -1}`);
  removed(tmp);
}, { timeout: 60_000 });

test("prompt writes its message and a space, then gives each line until input ends", () => {
  const tmp = scratch("fish-stdin-");
  const binary = built(tmp, "prompt", `function main() {
  const a = prompt("name?");
  console.log(\`[\${a ?? "none"}]\`);
  const b = prompt();
  console.log(\`[\${b ?? "none"}]\`);
  console.log(\`[\${prompt("more?") ?? "none"}]\`);
}
`);
  same(piped(tmp, binary, [utf8("fish\r\n"), utf8("two\n")], 20), "name? [fish]\n [two]\nmore? [none]\n", "the output");
  removed(tmp);
}, { timeout: 60_000 });

test("for await over process.stdin gives what has arrived as each chunk, ending with input", () => {
  const tmp = scratch("fish-stdin-");
  const binary = built(tmp, "chunks", `async function main() {
  let text = "";
  for await (const chunk of process.stdin) text += new TextDecoder().decode(chunk);
  console.log(text.length, text.replaceAll("\\n", "|"));
}
`);
  same(piped(tmp, binary, [utf8("abc"), utf8("def\n"), [], utf8("ghi")], 50), "10 abcdef|ghi\n", "the output");
  removed(tmp);
}, { timeout: 60_000 });
