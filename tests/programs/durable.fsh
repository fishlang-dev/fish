// case: durable_records_then_replays
// expect: record 0 {"amount":3,"to":"ann"}
// expect: charging 3
// expect: record 1 300
// expect: emailing ann
// expect: record 2 null
// expect: finish
// expect: charged 300 to ann
// expect: emailing bob
// expect: record 2 null
// expect: finish
// expect: charged 500 to bob
import { Durable } from "std:durable";

type Kept = shared<{ steps: Lock<string[]> }>;

// A store for one run at a time, printing what it is asked to keep.
class Memory {
  kept: Kept;
  constructor(kept: Kept) {
    this.kept = kept;
  }
  async steps(_run: string): Promise<string[]> {
    return this.kept.steps.read((s) => s.clone());
  }
  async record(_run: string, step: i64, value: string): Promise<void> {
    console.log("record", step, value);
    this.kept.steps.update((s) => {
      s.push(value);
    });
  }
  async finish(_run: string): Promise<void> {
    console.log("finish");
  }
  async unfinished(): Promise<string[]> {
    return [];
  }
}

async function charge(amount: i64): Promise<i64> {
  console.log("charging", amount);
  return amount * 100;
}

async function email(to: string): Promise<void> {
  console.log("emailing", to);
}

@durable
async function order(run: Durable, amount: i64, to: string): Promise<string> {
  const cents: i64 = await charge(amount);
  await email(to);
  return "charged " + String(cents) + " to " + to;
}

async function main(): Promise<void> {
  const fresh: Kept = shared({ steps: new Lock<string[]>([]) });
  console.log(await order(new Durable(new Memory(fresh), "o-1"), 3, "ann"));
  // A run a crash stopped after its charge: its arguments and the charge come back from the
  // record, so only the email runs.
  const stopped: Kept = shared({ steps: new Lock<string[]>(["{\"amount\":5,\"to\":\"bob\"}", "500"]) });
  console.log(await order(new Durable(new Memory(stopped), "o-2"), 0, ""));
}
// case: durable_loop_assign_and_sqlite
// expect: step 1
// expect: step 2
// expect: step 3
// expect: total 6
// expect: unfinished []
// expect: one
// expect: caught stop
// expect: unfinished ["r-1"]
// expect: caught stop
import { Durable, SqliteStore } from "std:durable";
import type { SqliteError } from "std:sqlite";

async function stepOf(n: i64): Promise<i64> {
  console.log("step", n);
  return n;
}

async function one(): Promise<i64> {
  console.log("one");
  return 1;
}

@durable
async function sum(run: Durable, count: i64): Promise<i64> {
  let total: i64 = 0;
  for (let i: i64 = 1; i <= count; i++) {
    let got: i64 = 0;
    got = await stepOf(i);
    total += got;
  }
  return total;
}

@durable
async function risky(run: Durable): Promise<i64> throws string {
  const a: i64 = await one();
  if (a > 0) throw "stop";
  return a;
}

async function main(): Promise<void> throws SqliteError {
  const store = await SqliteStore.open(":memory:");
  console.log("total", await sum(new Durable(store.clone(), "s-1"), 3));
  console.log("unfinished", JSON.stringify(await store.unfinished()));
  try {
    await risky(new Durable(store.clone(), "r-1"));
  } catch (e) {
    console.log("caught", e);
  }
  console.log("unfinished", JSON.stringify(await store.unfinished()));
  // The second try replays what 'one' gave, so it doesn't run again.
  try {
    await risky(new Durable(store.clone(), "r-1"));
  } catch (e) {
    console.log("caught", e);
  }
}
// case: durable_not_async
// error: '@durable' marks an async function, whose awaits it records
import { Durable } from "std:durable";
@durable
function f(run: Durable): void {}
function main() {}
// case: durable_without_run
// error: 'f' takes its run first, a 'Durable' from std:durable
@durable
async function f(n: i64): Promise<void> {
  console.log(n);
}
function main() {}
// case: durable_untyped_await
// error: write the type of 'x', as in 'const x: T = await ...'
import { Durable } from "std:durable";
async function g(): Promise<i64> {
  return 1;
}
@durable
async function f(run: Durable): Promise<void> {
  const x = await g();
  console.log(x);
}
function main() {}
// case: durable_nested_await
// error: in a @durable function, an await is a statement of its own
import { Durable } from "std:durable";
async function g(): Promise<i64> {
  return 1;
}
@durable
async function f(run: Durable): Promise<void> {
  console.log(await g());
}
function main() {}
// case: durable_local_not_json
// error: values of type 'P' can't be written as JSON
import { Durable } from "std:durable";
class P {
  n: i64;
  constructor(n: i64) {
    this.n = n;
  }
}
async function g(): Promise<void> {}
@durable
async function f(run: Durable): Promise<void> {
  const p = new P(1);
  await g();
  console.log(p.n);
}
function main() {}
