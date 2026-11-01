// case: comptime
// mode: parse
macro function derive(input: Ast): Ast {
  return input
}
function repeat(comptime n: i64, s: string): string {
  comptime {
    assert(n > 0)
  }
  return s
}
const table = comptime buildTable(256)
const size = comptime 4 * 1024
let comptime = 1
let viaCall = comptime(2)
let macro = comptime - 1
// case: comptime_aggregates
// expect: 3 e2 20 1
// expect: 1 25 5
// expect: true
// expect: 7 here
// expect: 6.75 6 0
// expect: 10 -1
// expect: 12.75
// expect: 3 e2 20 1
// expect: 1 25 5
// expect: true
// expect: 7 here
// expect: 6.75 6 0
// expect: 10 -1
// expect: 12.75
// Arrays, objects, instances, enums and Options computed while compiling, baked, and read at
// run time, alongside the same code run at run time.
enum Color { Red, Green, Blue }
enum Shape { Circle(f64), Rect(f64, f64), Dot }
type Entry = { name: string; code: i64; tags: string[] };
class Point {
  x: i64;
  y: i64;
  constructor(x: i64, y: i64) { this.x = x; this.y = y; }
  sum(): i64 { return this.x + this.y; }
}
class Labeled extends Point {
  label: string;
  constructor(x: i64, y: i64, label: string) { super(x, y); this.label = label; }
}
function table(): Entry[] {
  let out: Entry[] = [];
  for (let i = 0; i < 3; i++) out.push({ name: "e" + String(i), code: i * 10, tags: ["t", String(i)] });
  return out;
}
function squares(n: i64): i64[] {
  let out: i64[] = [];
  for (let i = 1; i <= n; i++) out.push(i * i);
  return out;
}
function pick(n: i64): Color {
  if (n === 0) return Color.Red;
  return n === 1 ? Color.Green : Color.Blue;
}
function shapes(): Shape[] {
  return [Shape.Circle(1.5), Shape.Rect(2, 3), Shape.Dot];
}
function area(s: Ref<Shape>): f64 {
  return match (s) {
    case Shape.Circle(r) => r * r * 3,
    case Shape.Rect(w, h) => w * h,
    case Shape.Dot => 0,
  };
}
function find(name: string): Entry | null {
  for (const e of table()) {
    if (e.name === name) return e.clone();
  }
  return null;
}
function total(): f64 {
  let t: f64 = 0;
  for (const s of shapes()) t += area(s);
  return t;
}
function main() {
  const t = comptime table();
  console.log(t.length, t[2].name, t[2].code, t[1].tags[1]);
  const sq = comptime squares(5);
  console.log(sq[0], sq[4], sq.length);
  const c = comptime pick(2);
  console.log(c === Color.Blue);
  const p = comptime new Labeled(3, 4, "here");
  console.log(p.sum(), p.label);
  const ss = comptime shapes();
  console.log(area(ss[0]), area(ss[1]), area(ss[2]));
  const f = comptime find("e1");
  const g = comptime find("zz");
  console.log(f?.code ?? -1, g?.code ?? -1);
  console.log(comptime total());
  // The same, at run time.
  const t2 = table();
  console.log(t2.length, t2[2].name, t2[2].code, t2[1].tags[1]);
  const sq2 = squares(5);
  console.log(sq2[0], sq2[4], sq2.length);
  console.log(pick(2) === Color.Blue);
  const p2 = new Labeled(3, 4, "here");
  console.log(p2.sum(), p2.label);
  const ss2 = shapes();
  console.log(area(ss2[0]), area(ss2[1]), area(ss2[2]));
  const f2 = find("e1");
  const g2 = find("zz");
  console.log(f2?.code ?? -1, g2?.code ?? -1);
  console.log(total());
}
// case: comptime_block_break
// error: 'break' can't leave a comptime block
// A comptime block runs while compiling, so nothing in it can jump out to the program.
function main() {
  while (true) {
    comptime { break; }
  }
}
// case: comptime_block_fails
// error: this comptime code threw an error it didn't catch: IoError: SIZE must be at least 4
// A top-level comptime block that throws is a compile error.
const SIZE = 3;
comptime {
  if (SIZE < 4) throw new IoError("SIZE must be at least 4");
}
function main() { console.log(SIZE); }
// case: comptime_block_return
// error: 'return' can't leave a comptime block
// A return in a comptime block would leave while compiling, so it is refused.
function f(): i64 {
  comptime { return 5; }
  return 1;
}
function main() { console.log(f()); }
// case: comptime_const_assign
// error: 'N' is a top-level const, computed while compiling, so it never changes
// A top-level const can't be assigned to.
const N = 3;
function main() { N = 4; }
// case: comptime_const_cycle
// error: 'A' needs its own value to compute its value
// Consts that need each other's values can't be computed.
const A: i64 = B + 1;
const B: i64 = A + 1;
function main() { console.log(A); }
// case: comptime_const_optional
// expect: 1 0 5
// A top-level const leaving out an optional field holds it empty, and comptime code reads it so.
type U = { a?: i64; b: i64 };
const X: U = { b: 1 };
const Y = X.a ?? 5;
function main() { console.log(X.b, X.a ?? 0, Y); }
// case: comptime_const_runtime
// error: 'Promise<TcpListener> throws IoError' can't be computed while compiling
// A top-level const needing run-time work, like a socket, is refused, naming it.
const L = TcpListener.bind("127.0.0.1", 0);
async function main(): Promise<void> {}
// case: comptime_consts
// expect: 4 hello world 1048576 16 mul 64 -1
// Top-level consts are computed while compiling and read from any function; comptime blocks
// check things while compiling.
type Op = { name: string; code: i64 };
function ops(): Op[] {
  let out: Op[] = [];
  const names = "add sub mul div".split(" ");
  for (let i = 0; i < names.length; i++) out.push({ name: names[i], code: (i + 1) as i64 * 16 });
  return out;
}
const OPS = ops();
const COUNT = OPS.length;
const GREETING = "hello " + "world";
const LIMIT: u32 = 1 << 20;
const SQUARES: i64[] = [1, 4, 9, 16];
comptime {
  if (COUNT !== 4) throw new IoError("expected four ops");
}
function code(name: string): i64 {
  for (const op of OPS) {
    if (op.name === name) return op.code;
  }
  return -1;
}
function main() {
  comptime {
    let total = 0;
    for (const s of SQUARES) total += s;
    if (total !== 30) throw new IoError("squares");
  }
  console.log(COUNT, GREETING, LIMIT, SQUARES[3], OPS[2].name, code("div"), code("nope"));
}
// case: comptime_depth
// error: this comptime code nests calls more than 1000 deep
// Comptime recursion that never ends stops at the depth limit.
function deep(n: i64): i64 { return deep(n + 1); }
function main() { console.log(comptime deep(0)); }
// case: comptime_divide
// error: this comptime code panicked: attempt to divide by zero
// Division by zero while compiling is a compile error.
function div(a: i64, b: i64): i64 { return a / b; }
function main() { console.log(comptime div(1, 0)); }
// case: comptime_empty_loop
// error: this comptime code took more than 10,000,000 steps
// An empty endless loop is stopped by the step limit too.
function main() {
  comptime { for (;;) {} }
}
// case: comptime_finally_panic
// error: this comptime code panicked: index out of bounds
// A panic skips finally, at comptime as at run time, so it is a compile error.
function grab(): i64 {
  const a: i64[] = [1, 2];
  try {
    return a[5];
  } finally {
    return 7;
  }
}
function main() { console.log(comptime grab()); }
// case: comptime_mut_bounds
// error: this comptime code panicked: index out of bounds: the len is 2 but the index is 5
// Lending an element to a Mut checks its index there, at comptime as at run time.
function nothing(m: Mut<i64>) {}
function all(): string {
  let a = [1, 2];
  nothing(a[5]);
  return "done";
}
function main() { console.log(comptime all()); console.log(all()); }
// case: comptime_mut_field
// expect: 11
// expect: 11
// A Mut kept in a field writes through to what it points at, at comptime too.
class D {
  m: Mut<i64>;
  constructor(m: Mut<i64>) { this.m = m; }
  add(this: Mut<this>) { this.m += 10; }
}
function all(): string {
  let x = 1;
  let d = new D(x);
  d.add();
  return `${x}`;
}
function main() { console.log(all()); console.log(comptime all()); }
// case: comptime_mut_let
// expect: 6
// expect: 6
// A Mut kept in a variable writes through, at comptime too.
function all(): string {
  let x = 1;
  let r: Mut<i64> = x;
  r += 5;
  return `${x}`;
}
function main() { console.log(all()); console.log(comptime all()); }
// case: comptime_mut_params
// expect: 101 hi! 3
// expect: 101 hi! 3
// Writes through Mut parameters reach the caller at comptime as at run time.
function poke(m: Mut<i64>) { m += 100; }
function setS(s: Mut<string>) { s = s + "!"; }
function swapArr(a: Mut<i64[]>) { a = [9, 9, 9]; }
type P = { x: i64 };
function t(): string {
  let n = 1;
  poke(n);
  let s = "hi";
  setS(s);
  let a = [1];
  swapArr(a);
  return `${n} ${s} ${a.length}`;
}
function main() { console.log(t()); console.log(comptime t()); }
// case: comptime_mut_retagged
// expect: 11
// expect: 11
// A Mut field of a record retagged for a union field keeps writing through.
type R = { m: Mut<i64>; v: u8 | i64 };
function small(): u8 { return 5; }
function all(): string {
  let x = 1;
  let r: R = { m: x, v: small() };
  r.m += 10;
  return `${x}`;
}
function main() { console.log(all()); console.log(comptime all()); }
// case: comptime_mut_return
// expect: 11
// expect: 11
// A Mut returned from a function writes through, at comptime too.
function pick(a: Mut<i64>): Mut<i64> { return a; }
function all(): string {
  let x = 1;
  let r = pick(x);
  r += 10;
  return `${x}`;
}
function main() { console.log(all()); console.log(comptime all()); }
// case: comptime_mut_shorthand
// expect: 6 17
// expect: 6 17
// A Mut given to a field by shorthand keeps writing through, at comptime too.
type H = { m: Mut<i64> };
type X = { x: Mut<i64> };
function viaParam(m: Mut<i64>) { let h: H = { m }; h.m += 5; }
function all(): string {
  let a = 1;
  viaParam(a);
  let x = 10;
  let hx: X = { x: x };
  hx.x += 7;
  return `${a} ${x}`;
}
function main() { console.log(all()); console.log(comptime all()); }
// case: comptime_mut_this
// expect: 1
// expect: 1
// 'this' lent to a Mut parameter is changed through it, at comptime too.
class C {
  n: i64;
  constructor() { this.n = 0; }
  bumpSelf(this: Mut<this>) { bump(this); }
}
function bump(c: Mut<C>) { c.n += 1; }
function all(): string {
  let c = new C();
  c.bumpSelf();
  return `${c.n}`;
}
function main() { console.log(all()); console.log(comptime all()); }
// case: comptime_mutable_globals
// expect: 8000 9 true
// A top-level const holding an Atomic or a Lock is a global the program changes, from any thread.
const HITS = new Atomic(0);
const NAMES = new Lock(["a"]);
const FLAG = new Atomic(false);
async function work(): Promise<i64> {
  for (let i = 0; i < 1000; i++) HITS.add(1);
  NAMES.update((names) => { names.push("x"); });
  return 0;
}
async function main(): Promise<void> {
  let hs: JoinHandle<i64>[] = [];
  for (let i = 0; i < 8; i++) hs.push(spawn(work()));
  while (hs.length > 0) { const h = hs.pop()!; const r = await h; }
  FLAG.store(true);
  const count = NAMES.update((names) => names.length as i64);
  console.log(HITS.load(), count, FLAG.load());
}
// case: comptime_numbers_strings
// expect: 0.1 0.30000000000000004 1e+21 1.5e-7 0 NaN Infinity -Infinity 123456789012345680000 0.3 Infinity
// expect: 0.1 0.30000000000000004 1e+21 1.5e-7 0 NaN Infinity -Infinity 123456789012345680000 0.3 Infinity
// expect: 9007200328482816 -56 128 -3 -1 4611686018427387904 -4611686018427387904 55 3 0 255
// expect: 9007200328482816 -56 128 -3 -1 4611686018427387904 -4611686018427387904 55 3 0 255
// expect: 14 rld hél llo hé 4 4 2 3 SS école [x] [ab] [abxyzx] -aaa abbc true 56832
// expect: 14 rld hél llo hé 4 4 2 3 SS école [x] [ab] [abxyzx] -aaa abbc true 56832
// expect: false true true
// expect: false true true
// expect: 0 
// expect: 0 
// Floats, conversions and string methods give the same results at comptime as at run time.
function floats(): string {
  const a: f32 = 0.1;
  const b: f64 = 0.1 + 0.2;
  const c: f64 = 1e21;
  const d: f64 = 1.5e-7;
  const z: f64 = -0.0;
  const n: f64 = 0.0 / 0.0;
  const i: f64 = 1.0 / 0.0;
  const big: f64 = 123456789012345680000.0;
  return `${a} ${b} ${c} ${d} ${z} ${n} ${i} ${-i} ${big} ${a * 3} ${1e300 * 1e10}`;
}
function ints(): string {
  const x: i64 = 9007199791611905;
  const f = x as f32;
  const u: u8 = 200;
  const s: i8 = -128;
  const m: i64 = -9223372036854775807 - 1;
  return `${f as i64} ${(u as i8)} ${(s as u8)} ${-7 / 2} ${-7 % 2} ${m >>> 1} ${m >> 1} ${~u} ${(3.9 as i64)} ${(-3.9 as u8)} ${(300.5 as u8)}`;
}
function strs(): string {
  const s = "héllo 😀 wörld";
  const parts = "a,b,,c".split(",");
  const lim = "a,b,c".split(",", 2);
  const e = "😀a".split("");
  return `${s.length} ${s.slice(-3)} ${s.slice(-100, 3)} ${s.substring(5, 2)} ${s.substring(-1, 2)} ${s.indexOf("o", -5)} ${parts.length} ${lim.length} ${e.length} ${"ß".toUpperCase()} ${"ÉCOLE".toLowerCase()} [${" x ".trim()}] [${"ab".padStart(5, "")}] [${"ab".padEnd(6, "xyz")}] ${"aaa".replace("", "-")} ${"abc".replace("b", "$&$&")} ${s.startsWith("é", 1)} ${s.charCodeAt(7)}`;
}
function cmp(): string {
  const a = "￿";
  const b = "😀";
  return `${a < b} ${"Z" < "a"} ${"é" > "z"}`;
}
function iter(): string {
  let n = 0;
  let out = "";
  
  return `${n} ${out}`;
}
function main() {
  console.log(comptime floats());
  console.log(floats());
  console.log(comptime ints());
  console.log(ints());
  console.log(comptime strs());
  console.log(strs());
  console.log(comptime cmp());
  console.log(cmp());
  console.log(comptime iter());
  console.log(iter());
}
// case: comptime_optional_chain
// expect: -1
// expect: -1
// expect: -1
// expect: -1
// expect: -1
// An optional chain on an empty Option is empty at comptime too, running nothing after it.
type In = { c: i64 };
type Out = { b: In };
class K {
  v: i64;
  constructor(v: i64) { this.v = v; }
  get twice(): i64 { return this.v * 2; }
  m(): i64 { return 42; }
  n(): i64 { return this.v; }
}
function chain(): string {
  const o: Out | null = null;
  const k: K | null = null;
  return `${o?.b.c ?? -1}`;
}
function call(): string {
  const k: K | null = null;
  return `${k?.m() ?? -1}`;
}
function call2(): string {
  const k: K | null = null;
  return `${k?.n() ?? -1}`;
}
function getter(): string {
  const k: K | null = null;
  return `${k?.twice ?? -1}`;
}
function main() {
  console.log(chain());

  console.log(call());
  console.log(comptime call());
  console.log(call2());

  console.log(getter());

}
// case: comptime_overflow
// error: this comptime code panicked: attempt to add with overflow
// A panic while compiling is a compile error at the comptime site.
function grow(): i64 { let x: i8 = 100; return (x + 100) as i64; }
function main() { console.log(comptime grow()); }
// case: comptime_param_accessor
// error: an accessor can't take a comptime parameter
// An accessor is given its value at run time.
class C { v: i64 = 0; set x(comptime n: i64) { this.v = n; } }
function main() { let c = new C(); c.x = 5; console.log(c.v); }
// case: comptime_param_async
// error: comptime parameters on async functions and generators are not supported yet
// An async function's state can't hold a comptime parameter yet.
async function g(comptime n: i64): Promise<i64> { return n; }
async function main(): Promise<void> { const v = await g(1); console.log(v); }
// case: comptime_param_check
// error: this comptime code threw an error it didn't catch: IoError: repeat needs at least one
// A comptime block in a function checks each value its comptime parameter is given.
function repeat(comptime n: i64, s: string): string {
  comptime {
    if (n < 1) throw new IoError("repeat needs at least one");
  }
  return s;
}
function main() { console.log(repeat(0, "x")); }
// case: comptime_param_closure
// error: comptime parameters on closures are not supported yet
// A closure's parameters are given at run time.
function main() {
  const f = (comptime n: i64) => n;
  console.log(f(1));
}
// case: comptime_param_closure_arg
// expect: 21 31
// A closure passes its function's comptime parameter on as a comptime argument.
function inner(comptime n: i64): i64 { return n * 10; }
function outer(comptime n: i64): i64 { const f = (x: i64) => inner(n) + x; return f(1); }
function main() { console.log(outer(2), outer(3)); }
// case: comptime_param_closure_read
// expect: 21 31
// Comptime code in a closure reads its function's comptime parameter.
function outer(comptime n: i64): i64 { const f = (x: i64) => (comptime n * 10) + x; return f(1); }
function main() { console.log(outer(2), outer(3)); }
// case: comptime_param_dyn
// error: its method 'scaled' takes a comptime parameter, so it has a version per value and no one method a Dyn could call
// A method with a comptime parameter can't be one a Dyn calls.
class Box { scaled(comptime k: i64): i64 { return k; } }
interface Scaler { scaled(k: i64): i64; }
function main() { const d: Dyn<Scaler> = new Box(); console.log(d.scaled(2)); }
// case: comptime_param_enum_call
// expect: LOUD
// A comptime call giving an enum member is a comptime argument.
enum Mode { Plain, Loud }
const L2 = Mode.Loud;
function pick(): Mode { return Mode.Loud; }
function shout(comptime mode: Mode): string { return mode === Mode.Loud ? "LOUD" : "plain"; }
function outer(comptime m: Mode): string { return shout(m); }
function main() { console.log(shout(comptime pick())); }
// case: comptime_param_enum_const
// expect: LOUD
// An enum held by a top-level const is a comptime argument.
enum Mode { Plain, Loud }
const L: Mode = Mode.Loud;
function shout(comptime mode: Mode): string { return mode === Mode.Loud ? "LOUD" : "plain"; }
function main() { console.log(shout(L)); }
// case: comptime_param_enum_forward
// expect: LOUD LOUD LOUD
// An enum member passed on from a comptime parameter is the same argument.
enum Mode { Plain, Loud }
function shout(comptime mode: Mode): string { return mode === Mode.Loud ? "LOUD" : "plain"; }
function outer(comptime m: Mode): string { return shout(m); }
function main() { console.log(shout(Mode.Loud), outer(Mode.Loud), shout(comptime Mode.Loud)); }
// case: comptime_param_export
// error: an exported function can't take a comptime parameter, since C calls it with run-time values
// An exported function is called from C, with run-time values.
export function lib(comptime n: i64): i64 { return n; }
function main() { console.log(lib(1)); }
// case: comptime_param_foreign
// error: a C function can't take a comptime parameter
// C takes every argument at run time.
declare function abs(comptime n: i32): i32;
function main() { console.log(unsafe { abs(-5) }); }
// case: comptime_param_from
// error: 'ApiError.from' wraps errors as they are raised at run time, so it can't take a comptime parameter
// A From wrapper is given each error as it is raised, at run time.
class DbError { constructor(public code: i64) {} }
class ApiError implements From<i64> {
  constructor(public status: i64) {}
  static from(comptime e: i64): ApiError { return new ApiError(500 + e); }
}
function h(): i64 throws ApiError { throw 3; }
function main() { try { console.log(h()); } catch (e) { console.log(e.status); } }
// case: comptime_param_generic_param
// expect: 13 13
// A generic class's comptime method called through a type-parameter value gets its value.
class G<T> { x: T; constructor(x: T) { this.x = x; } rep(comptime n: i64, y: i64): i64 { return n * y; } }
function use<T>(g: G<T>): i64 { return g.rep(2, 5) + g.rep(3, 1); }
function main() { const g = new G<string>("a"); const h = new G<i64>(1); console.log(use(g), use(h)); }
// case: comptime_param_generic_this
// expect: 10 15
// A generic class's comptime method called through 'this' gets its value.
class G<T> { x: T; constructor(x: T) { this.x = x; } rep(comptime n: i64, y: i64): i64 { return n * y; } twice(): i64 { return this.rep(2, 5); } }
function main() { const g = new G<string>("a"); console.log(g.twice(), g.rep(3, 5)); }
// case: comptime_param_in_progress
// error: this comptime code calls 'h', which is still being checked, so it can't run yet
// A comptime argument can't run a function the checker is still in the middle of.
function rep(comptime n: i64): i64 { return n; }
function h(n: i64): i64 { if (n === 0) return rep(comptime h(1)); const y = n * 10; return y; }
function main() { console.log(h(0)); }
// case: comptime_param_mutual
// expect: 3
// Mutual recursion passing a comptime value on reuses the instances.
function a(comptime n: i64, x: i64): i64 { return x <= 0 ? n : b(n, x - 1); }
function b(comptime n: i64, x: i64): i64 { return a(n, x - 1); }
function main() { console.log(a(3, 4)); }
// case: comptime_param_optional
// expect: 2 2
// A function with a comptime parameter may leave out a trailing optional parameter.
function app(comptime n: i64, s?: string): i64 { return n; }
function main() { console.log(app(2), app(2, "x")); }
// case: comptime_param_recursion
// error: instantiating 'down' never ends: each instance needs another with a different comptime value
// Recursing with a new comptime value each time stops at the instantiation limit.
function down(comptime n: i64): i64 { return n === 0 ? 0 : down(n - 1); }
function main() { console.log(down(3)); }
// case: comptime_param_runtime
// error: 'k' is only known when the program runs, so comptime code can't read it
// A comptime parameter's argument must be known while compiling.
function rep(comptime n: i64): i64 { return n; }
function main() { const k = 3; console.log(rep(k)); }
// case: comptime_param_same_value
// expect: 3
// Recursing with the same comptime value reuses the instance.
function f(comptime n: i64, x: i64): i64 { return x === 0 ? n : f(n, x - 1); }
function main() { console.log(f(3, 4)); }
// case: comptime_param_two_enums
// expect: B.X B.X
// Members of two enums sharing a value compare equal, at comptime as at run time, where literals
// compare by value.
enum A { X, Y }
enum B { X, Y }
function which(comptime v: A | B): string {
  if (v === B.X) return "B.X";
  if (v === A.X) return "A.X";
  return "other";
}
function main() { console.log(which(A.X), which(B.X)); }
// case: comptime_param_type
// error: a comptime parameter takes an integer, a boolean, a string, an enum member or a string array, not 'i64[]'
// A comptime parameter's values must compare, to make one instance per value.
function sum(comptime xs: i64[]): i64 { return 0; }
function main() { console.log(sum([1])); }
// case: comptime_param_union_const
// expect: hi a num
// A union held by a top-level const is a comptime argument.
const U: i64 | string = "hi";
function f(comptime x: i64 | string): string { return typeof x === "string" ? x : "num"; }
function main() { console.log(f(U), f("a"), f(3)); }
// case: comptime_params
// expect: ababab ababababab xx yyy
// expect: HI! hi
// expect: 210 315
// expect: zzz
// A comptime parameter is given while compiling: each value makes an instance in which the
// parameter is a constant, that comptime code reads too.
enum Mode { Plain, Loud }
const TIMES = 2;
function repeat(comptime n: i64, s: string): string {
  comptime {
    if (n < 1) throw new IoError("repeat needs at least one");
  }
  let out = "";
  for (let i = 0; i < n; i++) out = out + s;
  return out;
}
function shout(comptime mode: Mode, s: string): string {
  return mode === Mode.Loud ? s.toUpperCase() + "!" : s;
}
function scaled(comptime k: i64, x: i64): i64 {
  const table = comptime k * 100;
  return x * k + table;
}
function count(): i64 { return later() + 1; }
function later(): i64 { return 2; }
function main() {
  console.log(repeat(3, "ab"), repeat(5, "ab"), repeat(TIMES, "x"), repeat(comptime TIMES + 1, "y"));
  console.log(shout(Mode.Loud, "hi"), shout(Mode.Plain, "hi"));
  console.log(scaled(2, 5), scaled(3, 5));
  console.log(repeat(comptime count(), "z"));
}
// case: comptime_place_order
// expect: 15 21 30 40 2
// expect: 15 21 30 40 2
// A place is found once, before the value: comptime runs assignments in the program's order.
class Ctr {
  n: usize;
  constructor() { this.n = 0; }
  next(this: Mut<this>): usize { this.n += 1; return this.n - 1; }
}
function f(): string {
  let c = new Ctr();
  let a: usize[] = [10, 20, 30, 40];
  a[c.next()] += 5;
  a[c.next()]++;

  return `${a[0]} ${a[1]} ${a[2]} ${a[3]} ${c.n}`;
}
function main() {
  console.log(f());
  console.log(comptime f());
}
// case: comptime_place_value_order
// expect: 1 20 30 40 2
// expect: 1 20 30 40 2
// An index is read before the value assigned to it, at comptime as at run time.
class Ctr {
  n: usize;
  constructor() { this.n = 0; }
  next(this: Mut<this>): usize { this.n += 1; return this.n - 1; }
}
function f(): string {
  let c = new Ctr();
  let a: usize[] = [10, 20, 30, 40];
  a[c.next()] = c.next();
  return `${a[0]} ${a[1]} ${a[2]} ${a[3]} ${c.n}`;
}
function main() {
  console.log(f());
  console.log(comptime f());
}
// case: comptime_print
// error: printing can't run while compiling: comptime code only computes values
// Comptime code computes values: printing is refused.
function say(): i64 { console.log("hi"); return 1; }
function main() { console.log(comptime say()); }
// case: comptime_runtime_local
// error: 'k' is only known when the program runs, so comptime code can't read it
// Comptime code can't read a run-time variable.
function main() { const k = 3; console.log(comptime k + 1); }
// case: comptime_steps
// error: this comptime code took more than 10,000,000 steps
// Comptime code that never ends stops at the step limit.
function spin(): i64 { let n = 0; while (true) { n = n + 1; if (n < 0) return n; } }
function main() { console.log(comptime spin()); }
// case: comptime_throw
// error: this comptime code threw an error it didn't catch: IoError: no such table
// An error thrown while compiling and not caught is a compile error at the comptime site.
function load(): i64 throws IoError {
  throw new IoError("no such table");
}
function main() {
  try {
    console.log(comptime load());
  } catch (e) {
    console.log(e.message);
  }
}
// case: comptime_try
// expect: caught bad 2
// Comptime code may throw and catch errors as values.
function parse(s: string): i64 throws IoError {
  if (s === "bad") throw new IoError("bad");
  return 2;
}
function both(): string {
  let out = "";
  try {
    const n = parse("bad");
    out = "no";
  } catch (e) {
    out = "caught " + e.message;
  }
  try {
    out = out + " " + String(parse("ok"));
  } catch (e) {
    out = "no";
  }
  return out;
}
function main() {
  console.log(comptime both());
}
// case: comptime_union_equality
// expect: other five n y false true
// expect: other five n y false true
// Comparing a union compares its member first, at comptime as at run time.
function small(): u8 { return 5; }
function big(): i64 { return 5; }
function sw(x: u8 | i64): string { switch (x) { case 5: return "five"; default: return "other"; } }
function eqLit(x: u8 | i64): string { return x === 5 ? "y" : "n"; }
function nul(x: u8 | i64 | null): string { const d: i64 = 5; return `${(x ?? d) === d}`; }
function all(): string { return `${sw(small())} ${sw(big())} ${eqLit(small())} ${eqLit(big())} ${nul(small())} ${nul(null)}`; }
function main() { console.log(all()); console.log(comptime all()); }
// case: comptime_union_fields
// expect: false false false false false false false
// expect: false false false false false false false
// A union field of an object keeps its member when the object is baked.
function small(): u8 { return 5; }
function kind(x: u8 | i64): string { const b: i64 = 5; return `${x === b}`; }
type Rec = { v: u8 | i64 };
type Outer = { r: Rec; vs: (u8 | i64)[] };
class Holder { v: u8 | i64; constructor() { this.v = small(); } }
enum Box { Of(u8 | i64) }
function a(): Rec { return { v: small() }; }
function b(): Rec { const r: Rec = { v: small() }; return r; }
function c(): Holder { return new Holder(); }
function d(): Outer { return { r: { v: small() }, vs: [small()] }; }
function e(): Box { return Box.Of(small()); }
function f(): Rec { let r: Rec = { v: 0 as i64 }; r.v = small(); return r; }
function eb(x: Box): string { return match (x) { case Box.Of(v) => kind(v) }; }
function main() {
  console.log(kind(a().v), kind(b().v), kind(c().v), kind(d().r.v), kind(d().vs[0]), eb(e()), kind(f().v));
  const A = comptime a(); const B = comptime b(); const C = comptime c(); const D = comptime d(); const E = comptime e(); const F = comptime f();
  console.log(kind(A.v), kind(B.v), kind(C.v), kind(D.r.v), kind(D.vs[0]), eb(E), kind(F.v));
}
// case: comptime_union_member
// expect: false true true false
// expect: false true true false
// A value entering a union keeps the member its type says, at comptime as at run time.
function mk(): u8 | i64 { const v: u8 = 5; return v; }
function mkf(): f32 | f64 { const v: f32 = 1.5; return v; }
function show(x: u8 | i64): string {
  const big: i64 = 5;
  const small: u8 = 5;
  return `${x === big} ${x === small}`;
}
function showf(x: f32 | f64): string {
  const a: f32 = 1.5;
  const b: f64 = 1.5;
  return `${x === a} ${x === b}`;
}
function main() {
  console.log(show(mk()), showf(mkf()));
  console.log(show(comptime mk()), showf(comptime mkf()));
}
// case: comptime_values
// expect: 75025 n5:-------01234 3.75 200 ABC 1024
// expect: 75025 n5:-------01234 3.75 200 ABC 1024
// `comptime` runs ordinary code while compiling and bakes its value; the same code at run time
// gives the same values.
function fib(n: i64): i64 {
  if (n < 2) return n;
  return fib(n - 1) + fib(n - 2);
}

function label(n: i64): string {
  let s = "";
  for (let i = 0; i < n; i++) s = s + String(i);
  return `n${n}:` + s.padStart(12, "-");
}

function main() {
  const f = comptime fib(25);
  const l = comptime label(5);
  const half = comptime 7.5 / 2;
  const big: u8 = comptime 200;
  console.log(f, l, half, big, comptime "abc".toUpperCase(), comptime 1 << 10);
  const small: u8 = 200;
  console.log(fib(25), label(5), 7.5 / 2, small, "abc".toUpperCase(), 1 << 10);
}
// case: comptime_assert_passing
// expect: 6
function factorial(n: i64): i64 {
  assert(n >= 0, "n is not negative");
  return n === 0 ? 1 : n * factorial(n - 1);
}
const six = comptime factorial(3);
function main() {
  console.log(six);
}
// case: comptime_assert_message
// error: comptime_assert_message.fsh:4:3: error: n is positive, not -1
// error: while running this comptime code
function positive(n: i64): i64 {
  assert(n > 0, "n is positive, not " + String(n));
  return n;
}
const n = comptime positive(-1);
function main() {
  console.log(n);
}
// case: comptime_assert_without_message
// error: comptime_assert_without_message.fsh:4:5: error: assertion failed: n > 0
function repeat(comptime n: i64, s: string): string {
  comptime {
    assert(n > 0)
  }
  return s;
}
function main() {
  console.log(repeat(0, "a"));
}
// case: comptime_assert_message_only_on_failure
// expect: 1
function boom(): string {
  const xs: i64[] = [];
  return String(xs[1]);
}
function one(): i64 {
  assert(true, boom());
  return 1;
}
const v = comptime one();
function main() {
  console.log(v);
}

// case: comptime_argument_tuple_element
// expect: 2
const K: [i64, string] = [1, "a"];
function up(comptime n: i64): i64 { return n + 1; }
function main() {
  console.log(up(K[0]));
}
