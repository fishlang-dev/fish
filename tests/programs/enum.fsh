// case: enum_computed
enum Flags {
  None = 0,
  A = 1 << 2,
  B = A | 1,
  C,
  D = Flags.B * 2 + Later.X,
}

enum Later {
  X = 100,
  Y = X - 1,
}

function main() {
  const f: Flags = Flags.C
  console.log(Flags.None, Flags.A, Flags.B, f, Flags.D, Later.Y, f === Flags.C)
}
// expect: 0 4 5 6 110 99 true
// case: enum_computed_bool
enum E {
  A = 1 < 2,
}

function main() {}
// error: enum member 'A' must be an integer or a string
// case: enum_computed_calls
function triple(n: i64): i64 {
  return n * 3
}

class K {
  static readonly V = 7
}

const BASE = 40

enum Calls {
  P = triple(2),
  Q = K.V + BASE,
  R,
}

function main() {
  console.log(Calls.P, Calls.Q, Calls.R)
}
// expect: 6 47 48
// case: enum_computed_cycle
enum E {
  A = F.X,
}

enum F {
  X = E.A,
}

function main() {}
// error: enum member 'X' uses 'E.A', which isn't computed yet; an initializer can only use members declared before it, and no value can depend on itself
// case: enum_computed_float
enum E {
  A = 1.5,
}

function main() {}
// error: enum member 'A' is 1.5, a float; a numeric enum holds i64 values, so give it an integer
// case: enum_computed_forward
enum E {
  A = B,
  B = 1,
}

function main() {}
// error: enum member 'A' uses 'E.B', which isn't computed yet; an initializer can only use members declared before it, and no value can depend on itself
// case: enum_computed_itself
function g(): i64 {
  return E.A
}

enum E {
  A = g(),
}

function main() {}
// error: enum member 'A' uses 'E.A', which isn't computed yet
// case: enum_computed_overflow
enum E {
  A = (1 << 62) * 4,
}

function main() {}
// error: this comptime code panicked: attempt to multiply with overflow
// case: enum_computed_range
enum E {
  A = 9223372036854775806 + 1,
  B,
}

function main() {}
// error: enum member 'B' is 9223372036854775808, which does not fit in i64
// case: enum_computed_runtime
enum E {
  A = Date.now(),
}

function main() {}
// error: 'now' can't run while compiling: comptime code only computes values
// case: enum_computed_strings
enum Names {
  Pre = "pre",
  Full = Names.Pre + "-" + "fix",
  Shout = `${Pre}!`,
}

function main() {
  console.log(Names.Pre, Names.Full, Names.Shout, "x" + Names.Pre + Names.Shout)
}
// expect: pre pre-fix pre! xprepre!
// case: enum_computed_string_next
enum E {
  A = "a" + 1,
  B,
}

function main() {}
// error: enum member 'B' must have an initializer
// case: enum_computed_unused
enum E {
  A = 1,
  B = E,
}

function main() {}
// error: an enum can't be used as a value; name one of its members
// case: enum_const
const enum Size {
  S = 1,
  M = S * 2,
  L,
}

declare const enum Mode {
  Off,
  On = "on",
}

function main() {
  console.log(Size.S, Size.M, Size.L, Mode.Off, Mode.On)
}
// expect: 1 2 3 0 on
// case: enum_declare
declare enum D {
  A,
}

function main() {}
// error: ambient declarations are not supported yet
// case: enum_const_member
enum Mode {
  Off,
  On,
}

function main() {
  const m = Mode.Off
  const n: Mode.Off = m
  print(n)
}
// expect: 0
// case: enum_data_count
enum E {
  A(i64, i64),
}

function main() {
  const x = E.A(1);
}
// error: 'E.A' holds 2 values, but 1 was given
// case: enum_data_mixed
enum E {
  A = 1,
  B(i64),
}

function main() {}
// error: enum 'E' mixes members with values and members holding data; split it into two enums
// case: enum_data_moved
type P = { n: i64 };
enum E {
  A(P),
  B,
}

function main() {
  const x = E.A({ n: 1 });
  const y = x;
  const z = x;
}
// error: 'x' was moved, so it can't be used here
// case: enum_data_payload_type
enum E {
  A(i64),
}

function main() {
  const x = E.A("s");
}
// error: argument of type '"s"' is not assignable to 'E.A', which holds 'i64'
// case: enum_data_print
enum E {
  A(i64),
  B,
}

function main() {
  console.log(E.B, E.A(1));
}
// expect: B A(1)
// case: enum_data_recursive
enum List {
  Cons(i64, List),
  Nil,
}

function sum(l: Ref<List>): i64 {
  return match (l) {
    case List.Cons(v, rest) => v + sum(rest),
    case List.Nil => 0,
  }
}

function main() {
  console.log(sum(List.Cons(1, List.Cons(2, List.Nil))))
}
// expect: 3
// case: enum_data_uncalled
enum E {
  A(i64),
  B,
}

function main() {
  const x = E.A;
}
// error: 'E.A' holds a value; build it with 'E.A(...)'
// case: enum_data_unit_called
enum E {
  A(i64),
  B,
}

function main() {
  const x = E.B();
}
// error: 'E.B' holds nothing, so it isn't called; write 'E.B'
// case: enum_data_values
enum Shape {
  Circle(f64),
  Rect(f64, f64),
  Label(string),
  Many(string[]),
  Empty,
}

type Box = { shape: Shape; note: string };

class Drawing {
  shapes: Shape[];
  constructor() {
    this.shapes = [];
  }
  add(this: Mut<this>, s: Shape) {
    this.shapes.push(s);
  }
}

function make(n: i64): Shape {
  if (n > 0) return Shape.Label("n" + n);
  return Shape.Empty;
}

function count(xs: Ref<Shape[]>): usize {
  return xs.length;
}

function main() {
  const a = Shape.Circle(1.5);
  let b: Shape = Shape.Rect(2.0, 3.0);
  b = make(4);
  const c = Shape.Many(["x" + 1, "y"]);
  const box: Box = { shape: Shape.Label("in" + 2), note: "n" + 3 };
  let d = new Drawing();
  d.add(Shape.Label("p" + 1));
  d.add(make(0));
  d.add(c);
  const copy = box.clone();
  const maybe: Shape | null = make(1);
  const list = [a, b, Shape.Empty];
  Shape.Label("dropped" + 1);
  console.log(count(d.shapes), count(list), copy.note, box.note, maybe === null);
}
// expect: 3 3 n3 n3 false
// case: enum_data_values_release
enum Shape {
  Circle(f64),
  Rect(f64, f64),
  Label(string),
  Many(string[]),
  Empty,
}

type Box = { shape: Shape; note: string };

class Drawing {
  shapes: Shape[];
  constructor() {
    this.shapes = [];
  }
  add(this: Mut<this>, s: Shape) {
    this.shapes.push(s);
  }
}

function make(n: i64): Shape {
  if (n > 0) return Shape.Label("n" + n);
  return Shape.Empty;
}

function count(xs: Ref<Shape[]>): usize {
  return xs.length;
}

function main() {
  const a = Shape.Circle(1.5);
  let b: Shape = Shape.Rect(2.0, 3.0);
  b = make(4);
  const c = Shape.Many(["x" + 1, "y"]);
  const box: Box = { shape: Shape.Label("in" + 2), note: "n" + 3 };
  let d = new Drawing();
  d.add(Shape.Label("p" + 1));
  d.add(make(0));
  d.add(c);
  const copy = box.clone();
  const maybe: Shape | null = make(1);
  const list = [a, b, Shape.Empty];
  Shape.Label("dropped" + 1);
  console.log(count(d.shapes), count(list), copy.note, box.note, maybe === null);
}
// mode: release
// expect: 3 3 n3 n3 false
// case: enum_expected_conditional
enum Maybe<T> { Some(T), Nothing }
function main() { const c = true; const m: Maybe<string> = c ? Maybe.Some("a") : Maybe.Nothing; console.log(1); }
// expect: 1
// case: enum_expected_numeric
enum Maybe<T> { Some(T), Nothing }
function main() {
  let a: Maybe<string> | Maybe<i64> = Maybe.Some(5);
  a = Maybe.Some("s" + 1);
  let b: Maybe<i32> | Maybe<f64> = Maybe.Some(1.5);
  let c: Maybe<string[]> | Maybe<string> = Maybe.Some("x" + 1);
  c = Maybe.Some(["y" + 1]);
  console.log(1);
}
// expect: 1
// case: enum_expected_types
enum Maybe<T> {
  Some(T),
  Nothing,
}

function wrapObj(o: { a: string }): Maybe<{ a: string }> {
  return Maybe.Some(o);
}

function takeSmall(m: Maybe<i32>): i64 {
  return 1;
}

class Holder {
  m: Maybe<string>;
  constructor(m: Maybe<string>) {
    this.m = m;
  }
}

function main() {
  const n = wrapObj({ a: "z" + 1 });
  const small: Maybe<i32> = Maybe.Some(5);
  const f: Maybe<f64> = Maybe.Some(1);
  let list: Maybe<string>[] = [];
  list.push(Maybe.Nothing);
  list.push(Maybe.Some("s" + 1));
  const h = new Holder(Maybe.Nothing);
  const nested: Maybe<Maybe<string>> = Maybe.Some(Maybe.Nothing);
  console.log(takeSmall(Maybe.Some(7)), list.length);
}
// expect: 1 2
// case: enum_from_i64
enum Color {
  Red,
  Green,
}

function main() {
  const c: Color = 0
}
// error: type 'i64' is not assignable to type 'Color'
// case: enum_generic
enum Result<T, E> {
  Ok(T),
  Err(E),
}

enum Maybe<T> {
  Some(T),
  Nothing,
}

type P = { name: string };

function parse(s: string): Result<i64, string> {
  if (s === "1") return Result.Ok(1);
  return Result.Err("bad " + s);
}

function wrap<T>(x: T): Maybe<T> {
  return Maybe.Some(x);
}

function take(r: Result<string, string>): i64 {
  return 1;
}

function main() {
  const a = parse("1");
  const b = parse("x");
  let c: Maybe<string> = Maybe.Nothing;
  c = Maybe.Some("s" + 1);
  const d = Maybe.Some({ name: "p" + 1 });
  const e: Maybe<P> = Maybe.Nothing;
  const f = wrap("w" + 2);
  const g = wrap(5);
  const h = Result.Ok<string, i64>("x" + 1);
  const n = take(Result.Err("e" + 3)) + take(Result.Ok("o"));
  const list: Maybe<i64>[] = [Maybe.Some(1), Maybe.Nothing];
  const nested: Maybe<Result<i64, string>> = Maybe.Some(parse("1"));
  console.log(n, list.length);
}
// expect: 2 2
// case: enum_generic_arity
enum R<T, E> {
  Ok(T),
  Err(E),
}

function main() {
  const x: R<i64> = R.Ok(1);
}
// error: enum 'R' takes 2 type arguments
// case: enum_generic_field
enum Maybe<T> {
  Some(T),
  Nothing,
}

class Cache<T> {
  slot: Maybe<T>;
  constructor() {
    this.slot = Maybe.Nothing;
  }
  put(this: Mut<this>, v: T) {
    this.slot = Maybe.Some(v);
  }
}

function main() {
  let c = new Cache<string>();
  c.put("v" + 1);
  c.put("w" + 2);
  let d = new Cache<i64>();
  d.put(3);
  console.log("ok");
}
// expect: ok
// case: enum_generic_release
enum Result<T, E> {
  Ok(T),
  Err(E),
}

enum Maybe<T> {
  Some(T),
  Nothing,
}

type P = { name: string };

function parse(s: string): Result<i64, string> {
  if (s === "1") return Result.Ok(1);
  return Result.Err("bad " + s);
}

function wrap<T>(x: T): Maybe<T> {
  return Maybe.Some(x);
}

function take(r: Result<string, string>): i64 {
  return 1;
}

function main() {
  const a = parse("1");
  const b = parse("x");
  let c: Maybe<string> = Maybe.Nothing;
  c = Maybe.Some("s" + 1);
  const d = Maybe.Some({ name: "p" + 1 });
  const e: Maybe<P> = Maybe.Nothing;
  const f = wrap("w" + 2);
  const g = wrap(5);
  const h = Result.Ok<string, i64>("x" + 1);
  const n = take(Result.Err("e" + 3)) + take(Result.Ok("o"));
  const list: Maybe<i64>[] = [Maybe.Some(1), Maybe.Nothing];
  const nested: Maybe<Result<i64, string>> = Maybe.Some(parse("1"));
  console.log(n, list.length);
}
// mode: release
// expect: 2 2
// case: enum_generic_undecided
enum Maybe<T> {
  Some(T),
  Nothing,
}

function main() {
  const x = Maybe.Nothing;
}
// error: can't tell what 'T' is for 'Maybe.Nothing'
// case: enum_initializer
enum Dir {
  Up = "UP",
  Down,
}

function main() {}
// error: enum member 'Down' must have an initializer
// case: enum_member
enum Color {
  Red,
}

function main() {
  print(Color.Blue)
}
// error: property 'Blue' does not exist on enum 'Color'
// case: enum_nested_deep
enum Maybe<T> { Some(T), Nothing }
function main() { const x: Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<i64>>>>>>>>>>>>>>>>>>>>>>>>>> = Maybe.Nothing; console.log(1); }
// expect: 1
// case: enum_polymorphic_recursion
enum Maybe<T> { Some(T), Nothing }
function deep<T>(x: T, n: i64): i64 { if (n === 0) return 0; return deep(Maybe.Some(x), n - 1); }
function main() { console.log(deep(1, 3)); }
// error: instantiating 'deep' never ends
// case: enum_range
enum Big {
  A = 99999999999999999999,
}

function main() {}
// error: enum member 'A' is 99999999999999999999, which does not fit in i64
// case: enum_range_counted
enum Edge {
  Max = 9223372036854775807,
  Next,
}

function main() {}
// error: enum member 'Next' is 9223372036854775808, which does not fit in i64
// case: enum_reference_payload
enum H {
  R(Ref<string[]>),
  N,
}

function main() {}
// error: enum members holding references are not supported yet
// case: enum_reverse
enum Color {
  Red,
}

function main() {
  print(Color[0])
}
// error: indexed access expressions are not supported yet
// case: enum_type_argument_count
enum Maybe<T> {
  Some(T),
  Nothing,
}

function main() {
  const x = Maybe.Some<i64, string>(1);
}
// error: enum 'Maybe' takes 1 type argument
// case: enum_widening
enum Mode {
  Off,
  On,
}

class Light {
  mode = Mode.Off

  toggle(this: Mut<this>) {
    this.mode = this.mode === Mode.On ? Mode.Off : Mode.On
  }
}

class Box<T> {
  constructor(public value: T) {}

  set(this: Mut<this>, value: T) {
    this.value = value
  }
}

function pick<T>(first: boolean, a: T, b: T): T {
  return first ? a : b
}

function main() {
  let m = Mode.Off
  m = Mode.On
  let light = new Light()
  light.toggle()
  let b = new Box(Mode.On)
  b.set(Mode.Off)
  let s = { mode: Mode.Off }
  s.mode = Mode.On
  print(m, light.mode, b.value, pick(false, Mode.On, Mode.Off), s.mode)
}
// expect: 1 1 0 0 1
// case: enum_local_computed
function f(): i64 {
  enum Local {
    A = 3,
    B = A << 1,
  }
  return Local.B
}

function main() {
  console.log(f())
}
// expect: 6
// case: enum_computed_alias
enum E {
  A = 1,
  B = A,
  C,
}

function main() {
  const b: E = E.B
  const n = match (b) {
    case E.A => "a",
    case _ => "other",
  }
  console.log(n, b === E.A, E.C)
}
// expect: a true 2
// case: enum_computed_retried
function takes(x: u8): i64 {
  return 0
}

function g(): i64 {
  let n = 1
  takes(n)
  return F.X
}

enum E {
  A = g(),
}

enum F {
  X = 1.5,
}

function main() {
  console.log(E.A)
}
// error: enum member 'X' is 1.5, a float; a numeric enum holds i64 values, so give it an integer
// case: enum_computed_shorthand
type Holder = { A: i64 }

function first(h: Holder): i64 {
  return h.A
}

enum E {
  A = 4,
  B = first({ A }) + 1,
}

function main() {
  console.log(E.B)
}
// expect: 5
// case: enum_string_union_join
enum Dir {
  Up = "UP",
  Down = "DOWN",
}

function pick(up: boolean): Dir {
  return up ? Dir.Up : Dir.Down
}

function main() {
  const d = pick(false)
  console.log("go " + d + "!", d + Dir.Up)
}
// expect: go DOWN! DOWNUP
