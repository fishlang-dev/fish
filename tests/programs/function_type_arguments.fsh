// case: fta_generic_function_and_class
// expect: 11
// expect: 11
// expect: 8
// expect: 9
// expect: 2
// A function type as a type argument is a stored callable: held through T, called, cloned and dropped.
class Box<T> {
  value: T;
  constructor(value: T) {
    this.value = value;
  }
}
function id<T>(x: T): T {
  return x;
}
function first<T>(xs: T[]): T {
  let ys = xs;
  ys.reverse();
  return ys.pop()!;
}
function main() {
  const k = 10 + 0;
  const b = new Box<() => i64>(() => k + 1);
  console.log(b.value());
  const c = new Box(b.value.clone());
  console.log(c.value());
  console.log(id<(x: i64) => i64>((x) => x * 2)(4));
  const named = (x: i64) => x - 1;
  console.log(id<(x: i64) => i64>(named)(10));
  const f: (x: i64) => i64 = (x) => x + 1;
  const g: (x: i64) => i64 = (x) => x + 2;
  console.log(first([f, g])(1));
}
// case: fta_inferred_and_throwing
// expect: 6
// expect: 8
// expect: caught -2
// A closure meeting T is boxed into the callable, and a throwing function type keeps its throws.
class Box<T> {
  value: T;
  constructor(value: T) {
    this.value = value;
  }
}
class Oops {
  code: i64;
  constructor(code: i64) {
    this.code = code;
  }
}
function main() {
  const k = 5 + 0;
  const b = new Box(move () => k + 1);
  console.log(b.value());
  const risky = new Box<(n: i64) => i64 throws Oops>((n) => {
    if (n < 0) throw new Oops(n);
    return n * 2;
  });
  try {
    console.log(risky.value(4));
    console.log(risky.value(-2));
  } catch (e) {
    console.log("caught", e.code);
  }
}
// case: fta_interface_tuple_promise_cell
// expect: 40
// expect: 3 three
// expect: later!
// expect: 1
interface Source<T> {
  take(): T;
}
class Maker implements Source<() => i64> {
  n: i64;
  constructor(n: i64) {
    this.n = n;
  }
  take(): () => i64 {
    const n = this.n;
    return () => n * 10;
  }
}
function pairUp<A, B>(a: A, b: B): [A, B] {
  return [a, b];
}
async function later(): Promise<() => string> {
  const s = "later" + "";
  return () => s + "!";
}
async function main(): Promise<void> {
  const m: Dyn<Source<() => i64>> = new Maker(4);
  console.log(m.take()());
  const p = pairUp<() => i64, string>(() => 3, "three" + "");
  console.log(p[0](), p[1]);
  const g = await later();
  console.log(g());
  const c = new Cell<() => i64>(() => 1);
  const old = c.replace(() => 2);
  console.log(old());
}
// case: fta_handler_registry
// expect: hello fish
// expect: FISH
// expect: false
// expect: #3 8
// expect: true
// expect: 1 2
type Handler = (body: string) => string;
class Registry<H> {
  handlers: Map<string, H> = new Map<string, H>();
  add(this: Mut<this>, name: string, h: H) {
    this.handlers.set(name, h);
  }
  has(name: string): boolean {
    return this.handlers.has(name);
  }
}
function count<T>(xs: Ref<T[]>): i64 {
  return xs.length as i64;
}
function main() {
  let routes = new Map<string, Handler>();
  const greeting = "hello " + "";
  routes.set("greet", move (b) => greeting + b);
  routes.set("shout", (b) => b.toUpperCase());
  console.log(routes.get("greet")!("fish"));
  console.log(routes.get("shout")!("fish"));
  console.log(routes.has("nope"));
  let r = new Registry<(n: i64) => string>();
  const tag = "#" + "";
  r.add("hash", move (n) => tag + n);
  r.add("double", (n) => `${n * 2}`);
  console.log(r.handlers.get("hash")!(3), r.handlers.get("double")!(4));
  const fs: (() => i64)[] = [() => 1, () => 2];
  console.log(count(fs) === 2);
  const pairs = new Map<string, () => i64>([["one" + "", () => 1], ["two" + "", () => 2]]);
  console.log(pairs.get("one")!(), pairs.get("two")!());
}
// case: fta_channel_and_lock
// expect: ran task
// expect: second
// expect: 7
// expect: 8
// A channel carries callables from one task to another; a lock holds one and swaps it.
async function main(): Promise<void> {
  const ch = new Channel<() => void>(4);
  const tx = ch.clone();
  const t = spawn(async () => {
    const n = "task" + "";
    await tx.send(move () => console.log("ran", n));
    await tx.send(() => console.log("second"));
    tx.close();
  });
  await t;
  while (true) {
    const job = await ch.receive();
    if (job === null) break;
    job();
  }
  const lock = new Lock<() => i64>(() => 7);
  console.log(lock.update((f) => f()));
  lock.update((f) => {
    f = () => 8;
  });
  console.log(lock.update((f) => f()));
}
// case: fta_moved
// error: 'b.value' can't be used here because 'b' was moved
class Box<T> {
  value: T;
  constructor(value: T) {
    this.value = value;
  }
}
function main() {
  const b = new Box<() => i64>(() => 1);
  const c = b;
  console.log(b.value());
}
// case: fta_moved_into_generic
// error: 'f' was moved, so it can't be used here
function id<T>(x: T): T {
  return x;
}
function main() {
  const f: () => i64 = () => 1;
  const g = id(f);
  console.log(f());
}
// case: fta_generic_function_type
// error: generic function types as type arguments are not supported yet
function id<T>(x: T): T {
  return x;
}
function main() {
  const f = id<<T>(x: T) => T>((x) => x);
}
// case: fta_generic_function_type_class
// error: generic function types as type arguments are not supported yet
class Box<T> {
  value: T;
  constructor(value: T) {
    this.value = value;
  }
}
function main() {
  const b = new Box<<T>(x: T) => T>((x) => x);
}
// case: fta_map_key
// error: a 'Map' is keyed by strings or integers, or unions of their literals, not '() => i64'
function main() {
  const m = new Map<() => i64, i64>();
}
// case: fta_set_member
// error: a 'Set' holds strings or integers, or unions of their literals, not '() => i64'
function main() {
  const s = new Set<() => i64>();
}
// case: fta_map_inferred
// error: a 'Map' of functions needs its types written, as in 'new Map<string, () => i64>(...)'
function main() {
  const m = new Map([["one" + "", () => 1]]);
}
// case: fta_named_function
// expect: 3
// expect: 4
// A declared function given where T is decided is boxed like a closure.
function add1(x: i64): i64 {
  return x + 1;
}
class Box<T> {
  value: T;
  constructor(value: T) {
    this.value = value;
  }
}
function main() {
  const b = new Box(add1);
  console.log(b.value(2));
  const c = new Box<(x: i64) => i64>(add1);
  console.log(c.value(3));
}
