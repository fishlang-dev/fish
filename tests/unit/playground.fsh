// The playground: the compiler's answers in process, through the entry its wasm build runs, and
// the share server built and run as the native fishc builds it, driven with curl.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { answer, type Answer } from "../../src/playground.fsh";
import { fishc, freePort, removed, root, same, scratch, text } from "./support.fsh";

function codes(a: Ref<Answer>): string {
  return a.diagnostics.map((d) => `${d.severity}[${d.code}] ${d.line}:${d.col}`).join(", ");
}

test("a program that checks is run through the interpreter, its printing kept in order", () => {
  const a = answer(`function twice(n: i64): i64 {\n  return n * 2;\n}\n\nfunction main() {\n  const xs = [1, 2, 3];\n  for (const x of xs) console.log("twice", x, "is", twice(x));\n  console.log(true, "done");\n}\n`);
  same(codes(a), "", "the diagnostics");
  same(a.output.join("\n"), "twice 1 is 2\ntwice 2 is 4\ntwice 3 is 6\ntrue done", "the output");
  assert(a.ran && a.note === "", `ran ${a.ran}, note ${a.note}`);
});

test("an ownership error is placed by line and column and explained", () => {
  const a = answer(`function take(s: string[]): usize {\n  return s.length;\n}\n\nfunction main() {\n  const xs = ["a"];\n  take(xs);\n  console.log(xs.length);\n}\n`);
  assert(a.diagnostics.length > 0 && a.diagnostics[0]!.code === "E0201" && a.diagnostics[0]!.line === 8, `the diagnostics: ${codes(a)}`);
  assert(a.explain.includes("move"), `the explanation:\n${a.explain}`);
  assert(!a.ran && a.output.length === 0, "a program with errors doesn't run");
});

test("what the interpreter can't run says so, a panic says where, and only std can be imported", () => {
  const waits = answer(`async function main(): Promise<void> {\n  await sleep(1);\n  console.log("late");\n}\n`);
  same(codes(waits), "", "an async main checks");
  assert(!waits.ran && waits.note.includes("the playground runs main() in the compiler's interpreter"), `the note: ${waits.note}`);
  const panics = answer(`function main() {\n  const xs: i64[] = [];\n  console.log("before");\n  console.log(xs[3]!);\n}\n`);
  same(panics.output.join("\n"), "before", "what printed before the panic");
  assert(!panics.ran && panics.note.startsWith("main() panicked at line 4"), `the note: ${panics.note}`);
  const imports = answer(`import { x } from "./other.fsh";\nfunction main() { console.log(x); }\n`);
  same(codes(imports), "error[E0901] 1:1", "a relative import");
  same(codes(answer(`import { join } from "std:path";\nfunction main() { console.log(join("a", "b")); }\n`)), "", "a std import");
});

test("the share server keeps a program under its hash, gives it back as text, and refuses bad links and large bodies", () => {
  const dir = scratch("fish-playground-");
  const binary = join(dir, "server");
  const build = fishc(dir, ["build", join(root(), "playground", "server.fsh"), "-o", binary]);
  same(build.err, "", "building the server");
  const port = freePort();
  const script = `bin=$1 port=$2 data=$3
PORT=$port PLAYGROUND_DATA=$data "$bin" > /dev/null 2>&1 &
pid=$!
trap 'kill $pid' EXIT
for i in $(seq 100); do curl -s -o /dev/null "http://127.0.0.1:$port/" && break; sleep 0.1; done
base="http://127.0.0.1:$port"
id=$(curl -s -X POST --data-binary 'function main() {}' "$base/api/share" | sed 's/.*"id":"\\([0-9a-f]*\\)".*/\\1/')
again=$(curl -s -X POST --data-binary 'function main() {}' "$base/api/share" | sed 's/.*"id":"\\([0-9a-f]*\\)".*/\\1/')
echo "same $([ "$id" = "$again" ] && echo yes) $(echo -n "$id" | wc -c | tr -d ' ')"
echo "back $(curl -s "$base/api/share/$id")|$(curl -s -o /dev/null -w '%{content_type}' "$base/api/share/$id")"
echo "unknown $(curl -s -o /dev/null -w '%{http_code}' "$base/api/share/000000000000")"
echo "bad $(curl -s -o /dev/null -w '%{http_code}' "$base/api/share/..%2f..%2fetc")"
echo "empty $(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/api/share")"
head -c 70000 /dev/zero | tr '\\0' 'a' > "$data/../big"
echo "large $(curl -s -o /dev/null -w '%{http_code}' -X POST --data-binary @"$data/../big" "$base/api/share")"
echo "page $(curl -s -o /dev/null -w '%{http_code}' "$base/")"`;
  const run = spawnSync("sh", ["-c", script, "sh", binary, `${port}`, join(dir, "shares")]);
  removed(dir);
  same(text(run.stdout), "same yes 12\nback function main() {}|text/plain; charset=utf-8\nunknown 404\nbad 404\nempty 400\nlarge 413\npage 200\n", `the server (stderr: ${text(run.stderr)})`);
}, { timeout: 120_000 });
