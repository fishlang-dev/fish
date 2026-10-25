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
// An interval runs until its own callback clears it, its state shared.
async function main(): Promise<void> {
  const state = shared({ count: new Atomic<i64>(0), id: new Atomic<i64>(0) });
  const s = state.clone();
  state.id.store(setInterval(() => {
    const n = s.count.add(1) + 1;
    console.log("tick", n);
    if (n === 3) clearInterval(s.id.load());
  }, 10));
  setTimeout(() => { console.log("timeout 25"); }, 25);
  console.log("set");
}
// case: interval_cleared_outside
// expect: every
// expect: every
// expect: stop
async function main(): Promise<void> {
  const id = setInterval(() => { console.log("every"); }, 10);
  setTimeout(() => {
    clearInterval(id);
    console.log("stop");
  }, 25);
}
