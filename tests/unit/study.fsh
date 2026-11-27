// The paper-test study: each task's starter meets an error and its solution prints what the Rust
// program prints, through the playground's compiler in process; the summary and event checks;
// and the server built by the native fishc, driven with curl.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { answer } from "../../src/playground.fsh";
import { invalid } from "../../study/server.fsh";
import { summarize, type EventRow } from "../../study/summary.fsh";
import { TASKS } from "../../study/tasks.fsh";
import { fishc, freePort, removed, root, same, scratch, text } from "./support.fsh";

test("each task's translation meets an error, and its solution prints what the Rust program does", () => {
  for (const t of TASKS) {
    const starter = answer(t.fish);
    assert(starter.diagnostics.some((d) => d.severity === "error"), `${t.id}: the starter checks, printing ${starter.output.join("\n")}`);
    const solved = answer(t.solution);
    const errors = solved.diagnostics.map((d) => `${d.line}:${d.col} ${d.code} ${d.message}`).join("; ");
    assert(errors === "" && solved.ran, `${t.id}: the solution: ${errors}${solved.note}`);
    same(solved.output.join("\n"), t.expect, `${t.id}: what the solution prints`);
  }
});

function row(session: string, task: string, kind: string, codes: string, ms: i64): EventRow {
  return { session, task, kind, codes, ms, at: 0 };
}

test("the summary counts each session once per task, takes the median time to solve, and ranks the errors met", () => {
  const events = [
    row("a", "lend", "start", "", 0), row("a", "lend", "compile", "E0201", 1000), row("a", "lend", "compile", "", 4000), row("a", "lend", "solved", "", 4000), row("a", "lend", "solved", "", 9000),
    row("b", "lend", "start", "", 0), row("b", "lend", "compile", "E0201,E0202", 2000), row("b", "lend", "solved", "", 10000),
    row("c", "lend", "start", "", 0), row("c", "lend", "giveup", "", 60000), row("c", "mutate", "start", "", 0),
  ];
  const all = summarize(events);
  same(all.map((s) => s.task).join(","), TASKS.map((t) => t.id).join(","), "one row per task, in order");
  const lend = all[0]!;
  same(`${lend.started} ${lend.compiles} ${lend.solved} ${lend.gaveUp} ${lend.medianMs ?? -1}`, "3 3 2 1 7000", "lend");
  same(lend.errors.map(([c, n]) => `${c}=${n}`).join(" "), "E0201=2 E0202=1", "the errors met");
  same(`${all[1]!.started} ${all[1]!.medianMs ?? -1}`, "1 -1", "a task nobody solved");
});

test("an event is refused unless its session, task, kind, codes and time are ones the page sends", () => {
  const good = { session: "0".repeat(32), task: "lend", kind: "compile", codes: ["E0201"], ms: 5 };
  same(invalid(good), "", "a good event");
  same(invalid({ ...good, session: "x" }), "the session id is 32 hex digits", "a bad session");
  same(invalid({ ...good, task: "nope" }), "there is no task 'nope'", "an unknown task");
  same(invalid({ ...good, kind: "typed" }), "an event is one of start, compile, solved, giveup", "an unknown kind");
  same(invalid({ ...good, codes: ["<script>"] }), "codes are at most 20 diagnostic codes, as E0201", "a code that isn't one");
  same(invalid({ ...good, ms: -1 }), "ms is the time since the task started, at most a day", "a negative time");
});

test("the server records events only for a consenting session, and gives them back as JSON and a summary", () => {
  const dir = scratch("fish-study-");
  const binary = join(dir, "study");
  const build = fishc(dir, ["build", join(root(), "study", "server.fsh"), "-o", binary]);
  same(build.err, "", "building the server");
  const port = freePort();
  const script = `bin=$1 port=$2 db=$3
PORT=$port STUDY_DB=$db "$bin" > /dev/null 2>&1 &
pid=$!
trap 'kill $pid' EXIT
base="http://127.0.0.1:$port"
for i in $(seq 100); do curl -s -o /dev/null "$base/api/tasks" && break; sleep 0.1; done
post() { curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' --data "$2" "$base$1"; }
echo "tasks $(curl -s "$base/api/tasks" | grep -o '"id":"[a-z]*"' | tr '\\n' ' ')"
echo "no consent $(post /api/sessions '{"consent":false}')"
id=$(curl -s -X POST --data '{"consent":true}' "$base/api/sessions" | sed 's/.*"id":"\\([0-9a-f]*\\)".*/\\1/')
echo "id $(echo -n "$id" | wc -c | tr -d ' ')"
echo "event $(post /api/events "{\\"session\\":\\"$id\\",\\"task\\":\\"lend\\",\\"kind\\":\\"compile\\",\\"codes\\":[\\"E0201\\"],\\"ms\\":1500}")"
echo "bad kind $(post /api/events "{\\"session\\":\\"$id\\",\\"task\\":\\"lend\\",\\"kind\\":\\"typed\\",\\"codes\\":[],\\"ms\\":1}")"
echo "unknown session $(post /api/events "{\\"session\\":\\"$(printf '0%.0s' $(seq 32))\\",\\"task\\":\\"lend\\",\\"kind\\":\\"start\\",\\"codes\\":[],\\"ms\\":0}")"
echo "not json $(post /api/events 'nope')"
echo "export $(curl -s "$base/export.json" | grep -o '"codes":"[A-Z0-9,]*"') $(curl -s "$base/export.json" | grep -o '"kind":"[a-z]*"')"
echo "summary $(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$base/summary") $(curl -s "$base/summary" | grep -c 'E0201 &times; 1')"
echo "page $(curl -s -o /dev/null -w '%{http_code}' "$base/") $(curl -s -o /dev/null -w '%{http_code}' "$base/compiler/worker.js")"`;
  const run = spawnSync("sh", ["-c", script, "sh", binary, `${port}`, join(dir, "study.db")]);
  removed(dir);
  same(text(run.stdout), [
    `tasks ${TASKS.map((t) => `"id":"${t.id}"`).join(" ")} `,
    "no consent 400",
    "id 32",
    "event 204",
    "bad kind 400",
    "unknown session 404",
    "not json 400",
    `export "codes":"E0201" "kind":"compile"`,
    "summary 200 text/html; charset=utf-8 1",
    "page 200 200",
    "",
  ].join("\n"), `the server (stderr: ${text(run.stderr)})`);
}, { timeout: 120_000 });
