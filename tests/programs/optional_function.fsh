// case: optional_function_parameters
// expect: 2
// expect: 3
// expect: none
// expect: done 1 t
// expect: done 2 t
// expect: none
// An optional callback parameter takes an arrow, a named function or nothing, and is called
// once a check finds it there, or with '?.()'.
function report(n: i64) { console.log(n); }
function run(f: (n: i64) => i64, after?: (n: i64) => void): i64 {
  const v = f(1);
  after?.(v);
  if (after !== undefined) after(v + 1);
  else console.log("none");
  return v;
}
function main() {
  const tag = "t";
  run((n) => n + 1, report);
  run((n) => n * 2);
  run((n) => n, (v) => console.log("done", v, tag));
  run((n) => n + 2, undefined);
}
// case: optional_function_results
// expect: 6
// expect: true
// expect: 10 true
// '?.()' gives an Option of what the function gives, empty when there is no function.
function twice(f?: (n: i64) => i64): i64 | undefined {
  return f?.(3);
}
function name(f?: (n: i64) => string): string | undefined {
  return f?.(5);
}
function main() {
  console.log(twice((n) => n * 2));
  console.log(twice() === undefined);
  const s = name((n) => `${n * 2}`);
  console.log(s, name() === undefined);
}
// case: optional_function_fields
// expect: done 4
// expect: true
// expect: closing a
// expect: none
// A field declared with '?' holds a function or nothing.
type Hooks = { done?: (n: i64) => void; name: string };
class Conn {
  name: string;
  onClose: (() => void) | undefined;
  constructor(name: string, onClose?: () => void) {
    this.name = name;
    this.onClose = onClose;
  }
  close() {
    if (this.onClose !== undefined) this.onClose();
    else console.log("none");
  }
}
function main() {
  const h: Hooks = { name: "a", done: (n) => console.log("done", n) };
  if (h.done !== undefined) h.done(4);
  const h2: Hooks = { name: "b" };
  console.log(h2.done === undefined);
  const label = "a";
  const c = new Conn("x", () => console.log("closing", label));
  c.close();
  new Conn("y").close();
}
// case: optional_function_variables
// expect: later 7
// expect: none
// expect: none
// expect: kept 1
// A variable of an optional function type is set, chosen and passed like any Option.
function pick(b: boolean): ((n: i64) => void) | undefined {
  let later: ((n: i64) => void) | undefined;
  if (b) later = (n) => console.log("later", n);
  else later = undefined;
  return later;
}
function call(f: ((n: i64) => void) | undefined) {
  if (f !== undefined) f(7);
  else console.log("none");
}
function main() {
  call(pick(true));
  call(pick(false));
  call(undefined);
  const words = ["kept"];
  const f: ((n: i64) => void) | undefined = (n) => console.log(words[0]!, n);
  f?.(1);
}
// case: optional_function_field_calls
// expect: after 2
// expect: after 1
// A field holding an optional function is called with '?.()', through a reference too.
type Hooks = { after?: (n: i64) => void; name: string };
function run(h: Ref<Hooks>) {
  h.after?.(1);
}
function main() {
  const h: Hooks = { name: "a", after: (n) => console.log("after", n) };
  h.after?.(2);
  run(h);
  const none: Hooks = { name: "b" };
  none.after?.(3);
  run(none);
}
// case: optional_function_field_unchecked
// error: 'after' may be missing, since its type is optional; call it as 'h.after?.()', or check it first
type Hooks = { after?: (n: i64) => void };
function main() {
  const h: Hooks = {};
  h.after(1);
}
// case: optional_function_conditional
// expect: give 1 t
// expect: other 2
// A '?:' choosing a function or nothing holds an optional function, owning what it captures.
function run(owned: boolean) {
  const tag = "t";
  const giveUp = owned ? (n: i64) => console.log("give", n, tag) : undefined;
  giveUp?.(1);
  const other: ((n: i64) => void) | undefined = owned ? undefined : (n) => console.log("other", n);
  if (other !== undefined) other(2);
}
function main() {
  run(true);
  run(false);
}
// case: optional_function_chain
// error: optional calls in an optional chain are not supported yet
type Inner = { f?: () => void };
type Outer = { inner?: Inner };
function main() {
  const o: Outer = {};
  o.inner?.f?.();
}
