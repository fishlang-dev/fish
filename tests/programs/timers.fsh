// case: timeout_order
// expect: main done
// expect: a 10
// expect: b 20
// expect: tie 1
// expect: tie 2
// expect: outer
// expect: inner
// Earliest first, ties in the order set; a cleared one never runs, and pending ones keep the program alive.
async function main(): Promise<void> {
  setTimeout(() => { console.log("b 20"); }, 20);
  setTimeout(() => { console.log("a 10"); }, 10);
  setTimeout(() => { console.log("tie 1"); }, 30);
  setTimeout(() => { console.log("tie 2"); }, 30);
  const t = setTimeout(() => { console.log("cleared"); }, 15);
  clearTimeout(t);
  setTimeout(() => {
    console.log("outer");
    setTimeout(() => { console.log("inner"); });
  }, 40);
  console.log("main done");
}
// case: timeout_callbacks
// expect: captured
// expect: tick
// expect: local
// expect: captured
function tick(): void { console.log("tick"); }
async function main(): Promise<void> {
  const shared = new Atomic<i64>(0);
  const f = () => { console.log("local"); };
  setTimeout(tick, 2);
  setTimeout(f, 4);
  const msg = "captured";
  setTimeout(() => { console.log(msg); }, 6);
  console.log(msg);
}
// case: timeout_changes_capture
// error: a timer's function owns what it captures, so changing 'n' would change only its own copy
async function main(): Promise<void> {
  let n = 0;
  setTimeout(() => { n++; }, 5);
}
// case: timeout_callback_expression
// error: 'setTimeout' takes a function written here or named, as in 'setTimeout(() => tick(), ms)'
function make(): () => void { return () => { console.log("m"); }; }
async function main(): Promise<void> { setTimeout(make(), 5); }
// case: timeout_delay_type
// error: a delay is milliseconds as an 'i64', not '"5"'
async function main(): Promise<void> { setTimeout(() => { console.log("x"); }, "5"); }
// case: timeout_no_function
// error: 'setTimeout' takes the function to run, then the milliseconds to wait
async function main(): Promise<void> { setTimeout(); }
// case: timeout_clear_null
// expect: done
async function main(): Promise<void> {
  clearTimeout(null);
  clearTimeout();
  const t: Timeout = setTimeout(() => { console.log("never"); }, 5);
  clearTimeout(t);
  clearTimeout(t);
  console.log("done");
}
// case: interval_cleared_inside
// expect: set
// expect: tick 1
// expect: tick 2
// expect: timeout 25
// expect: tick 3
// An interval runs until its own callback clears it, its state shared; a timeout set by its
// second run fires before its third.
async function main(): Promise<void> {
  const state = shared({ count: new Atomic<i64>(0), id: new Atomic<i64>(0) });
  const s = state.clone();
  state.id.store(setInterval(() => {
    const n = s.count.add(1) + 1;
    console.log("tick", n);
    if (n === 2) setTimeout(() => { console.log("timeout 25"); }, 0);
    if (n === 3) clearInterval(s.id.load());
  }, 100));
  console.log("set");
}
// case: interval_cleared_outside
// expect: every
// expect: every
// expect: stop
// The clearing timeout is set by the interval's second run, due long before its third.
async function main(): Promise<void> {
  const state = shared({ count: new Atomic<i64>(0), id: new Atomic<i64>(0) });
  const s = state.clone();
  state.id.store(setInterval(() => {
    console.log("every");
    if (s.count.add(1) + 1 === 2) {
      const t = s.clone();
      setTimeout(() => {
        clearInterval(t.id.load());
        console.log("stop");
      }, 0);
    }
  }, 100));
}
// case: timeout_arguments_and_async
// expect: named 1
// expect: arrow lit
// expect: untyped 3 -4
// expect: async start
// expect: after async
// expect: async end
// expect: slow start
// expect: slow end
// Passed values reach the function; an async one runs on while later timers fire, as in Node.
function show(label: string, n: i64): void { console.log(label, n); }
async function slow(label: string): Promise<void> {
  console.log(label, "start");
  await sleep(30);
  console.log(label, "end");
}
async function main(): Promise<void> {
  const name = "named";
  setTimeout(show, 5, name, 1);
  setTimeout((x: string) => { console.log("arrow", x); }, 10, "lit");
  setTimeout((a, b) => { console.log("untyped", a, b); }, 12, 3, -4);
  setTimeout(async () => {
    console.log("async start");
    await sleep(20);
    console.log("async end");
  }, 15);
  setTimeout(() => { console.log("after async"); }, 20);
  setTimeout(slow, 50, "slow");
}
// case: timeout_too_many_arguments
// error: 'setTimeout' passes at most two arguments on to its function so far
function f(a: i64, b: i64, c: i64): void {}
async function main(): Promise<void> { setTimeout(f, 1, 1, 2, 3); }
// case: timeout_argument_expression
// error: 'setTimeout' passes on a name or a literal; give this value a name first
function f(a: i64): void {}
function g(): i64 { return 1; }
async function main(): Promise<void> { setTimeout(f, 1, g()); }
// case: timeout_argument_type
// error: argument of type '"s"' is not assignable to parameter of type 'i64'
function f(a: i64): void {}
async function main(): Promise<void> { setTimeout(f, 1, "s"); }
// case: timers_sync_main
// expect: main returns
// expect: tick
// expect: tick
// expect: later
// A program setting timers runs on the async runtime, so a sync main's timers fire after it returns.
function main(): void {
  const state = shared({ count: new Atomic<i64>(0), id: new Atomic<i64>(0) });
  const s = state.clone();
  state.id.store(setInterval(() => {
    console.log("tick");
    if (s.count.add(1) + 1 === 2) clearInterval(s.id.load());
  }, 20));
  setTimeout(() => { console.log("later"); }, 300);
  console.log("main returns");
}
// case: timers_sync_main_no_type
// expect: done
function main() {
  setTimeout(() => { console.log("done"); }, 1);
}
// case: timeout_async_arrow_captures
// expect: 2
async function main(): Promise<void> {
  const xs = [1, 2];
  setTimeout(async () => { await sleep(1); console.log(xs.length); }, 1);
}
// case: timeout_generic_passed
// expect: 5
// expect: true
function later<T>(x: T): void {
  setTimeout((v) => { console.log(v); }, 1, x);
}
async function main(): Promise<void> {
  later(5);
  later(true);
}
// case: timeout_gives_promise
// expect: arrow start
// expect: arrow end
// expect: fn start
// expect: fn end
// A callback giving a Promise without being async runs on as an async one does.
async function slow(label: string): Promise<void> { console.log(label, "start"); await sleep(5); console.log(label, "end"); }
function viaPromise(): Promise<void> { return slow("fn"); }
async function main(): Promise<void> {
  setTimeout(() => slow("arrow"), 1);
  setTimeout(viaPromise, 20);
}
// case: interval_passed_copies
// expect: 3
// expect: 3
// expect: stop
// Each run is passed its own copy of a value that doesn't copy.
async function main(): Promise<void> {
  const arr = [1, 2, 3];
  const state = shared({ count: new Atomic<i64>(0), id: new Atomic<i64>(0) });
  const s = state.clone();
  state.id.store(setInterval((xs: i64[]) => {
    console.log(xs.length);
    if (s.count.add(1) + 1 === 2) {
      clearInterval(s.id.load());
      console.log("stop");
    }
  }, 10, arr));
}
// case: timers_sync_main_await
// error: 'await' can only be used inside an 'async' function
function main(): void {
  setTimeout(() => { console.log("t"); }, 1);
  await sleep(5);
}
// case: timers_comptime
// error: 'setTimeout' can't run while compiling
const t = setTimeout(() => { console.log("top"); }, 1);
async function main(): Promise<void> { console.log("main"); }
// case: timeout_async_arrow_forms
// expect: x 4
// expect: ok
async function main(): Promise<void> {
  setTimeout(async (x: i64 = 4) => { console.log("x", x); }, 1);
  setTimeout(async () => 5, 5);
  setTimeout(() => { console.log("ok"); }, 10);
}
// case: timeout_block_gives_promise
// expect: block start
// expect: block end
async function slow(label: string): Promise<void> { console.log(label, "start"); await sleep(5); console.log(label, "end"); }
async function main(): Promise<void> {
  setTimeout(() => { return slow("block"); }, 1);
}
// case: timeout_async_awaits_timer
// expect: main done
// expect: callback start
// expect: callback end
// An async callback awaiting another timer doesn't hold up the timer task that fires it.
function delay(ms: i64): Promise<void> { return new Promise((resolve) => { setTimeout(resolve, ms); }); }
async function main(): Promise<void> {
  setTimeout(async () => {
    console.log("callback start");
    await delay(10);
    console.log("callback end");
  }, 1);
  console.log("main done");
}
// case: timeout_async_ties_in_order
// expect: a
// expect: b
// expect: c
// expect: d
// Timers due together run in the order set, an async one's first part included.
async function main(): Promise<void> {
  setTimeout(async () => { console.log("a"); }, 0);
  setTimeout(() => { console.log("b"); }, 0);
  setTimeout(async () => { console.log("c"); }, 0);
  setTimeout(() => { console.log("d"); }, 0);
}
