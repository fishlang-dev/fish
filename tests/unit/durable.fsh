// A @durable function's run resumed by a new process after the one running it died between two
// awaits, its steps in a SQLite file: what it recorded isn't run again, and a finished run's id
// starts afresh.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { built, removed, same, scratch, text } from "./support.fsh";

const PROGRAM = String.raw`import { Durable, SqliteStore } from "std:durable";
import type { SqliteError } from "std:sqlite";

async function work(name: string): Promise<string> {
  console.log("ran", name);
  return name + "!";
}

// The crash: the process ends while this await runs, before it is recorded.
async function stop(): Promise<void> {
  if (process.argv.includes("crash")) process.exit(3);
}

@durable
async function job(run: Durable, label: string): Promise<string> {
  const a: string = await work("a");
  await stop();
  const b: string = await work("b");
  return label + " " + a + b;
}

async function main(): Promise<void> throws SqliteError {
  const store = await SqliteStore.open(process.argv[2]!);
  const out: string = await job(new Durable(store, "job-1"), process.argv[3]!);
  console.log(out);
}
`;

type Ran = { code: i64; out: string };

function ran(binary: string, args: string[]): Ran {
  const r = spawnSync(binary, args);
  return { code: r.status ?? -1, out: text(r.stdout) };
}

test("a durable run resumes after a crash from what it recorded, and its id starts afresh once it finished", () => {
  const dir = scratch("fish-durable-");
  const binary = built(dir, "job", PROGRAM);
  const db = join(dir, "runs.db");
  const crashed = ran(binary, [db, "crash"]);
  same(crashed.out, "ran a\n", "the run the crash stopped");
  assert(crashed.code === 3, `the crashed run exited with ${crashed.code}`);
  // Its label comes back from the record, and only the steps after the crash run.
  const resumed = ran(binary, [db, "second"]);
  same(resumed.out, "ran b\ncrash a!b!\n", "the resumed run");
  assert(resumed.code === 0, `the resumed run exited with ${resumed.code}`);
  const again = ran(binary, [db, "third"]);
  same(again.out, "ran a\nran b\nthird a!b!\n", "a new run under the finished one's id");
  removed(dir);
}, { timeout: 300_000 });
