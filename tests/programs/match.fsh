// case: match
// mode: parse
function describe(value: Option<i64>, response: Result<User, ApiError>) {
  let n = match (value) {
    case Some(v) => v,
    case None => 0,
  }
  let size = match (n) {
    case 0 => "none",
    case 1 | 2 => "few",
    case x if x > 100 => "many",
    case _ => "some",
  }
  return match (response) {
    case Ok(user) => user.name,
    case Err(ApiError.NotFound) => "missing",
    case Err(e) => {
      log(e)
      return "error"
    },
  }
}
let viaCall = match(pattern)
let shape = match (input) {
  case { kind: "circle", radius } => radius * radius,
  case { kind: "rect", size: [w, h] } | { kind: "square", size: [w, h] } => w * h,
  case [first, , ...rest] => first,
  case Point({ x: 0, y }) => y,
  case _ => 0,
}
// case: match_arm_bare_return
function f(n: i64): i64 {
  return match (n) {
    case 0 => {
      return;
    },
    case _ => 2,
  };
}

function main() {
  console.log(f(0));
}
// error: this match gives a value, so a 'return' in its arm needs one
// case: match_arm_break
function main() {
  for (let i = 0; i < 3; i++) {
    match (i) {
      case 1 => {
        break;
      },
      case _ => console.log(i),
    }
  }
}
// error: 'break' can't leave a match arm, which is a body of its own like an arrow's
// case: match_arm_moves
class Box {
  v: i64;
  constructor(v: i64) {
    this.v = v;
  }
}

function main() {
  const b = new Box(1);
  const got = match (b.v) {
    case 1 => {
      return b;
    },
    case _ => new Box(0),
  };
  console.log(got.v, b.v);
}
// error: 'b.v' can't be used here because 'b' was moved
// case: match_arm_no_value
function f(n: i64): i64 {
  return match (n) {
    case 0 => {
      if (n > 0) return 1;
    },
    case _ => 2,
  };
}

function main() {
  console.log(f(0));
}
// error: this arm can reach its end without giving a value; give one with 'return'
// case: match_arm_panic
function pick(n: i64): string {
  const xs = ["a", "b"];
  return "got " + match (n) {
    case 0 => {
      const local = "x" + n;
      return local + xs[(n + 5) as usize];
    },
    case _ => "none",
  };
}

function main() {
  const s = "outer";
  console.log(s + "!", pick(1), pick(0));
}
// panic: index out of bounds
// case: match_arm_switch
function label(n: i64): string {
  const s: string = match (n) {
    case 0 => "zero",
    case _ => {
      switch (n % 2) {
        case 0: return "even";
      }
      return "odd";
    },
  };
  return s;
}
function show(a: string, b: string): string { return a + b; }
function main() {
  for (let i = 0; i < 3; i++) {
    console.log(show("n=" + i, match (i) {
      case 0 => "zero",
      case _ => {
        switch (i % 2) {
          case 0: return " even";
        }
        return " odd";
      },
    }));
  }
}
// expect: n=0zero
// expect: n=1 odd
// expect: n=2 even
// case: match_arm_types
function small(n: i64): u8 {
  return match (n) {
    case 0 => 1,
    case _ => 2,
  };
}

function pick(n: i64): u8 {
  return n === 0 ? 3 : 4;
}

function mixed(n: i64, x: u8): u8 {
  const v = match (n) {
    case 0 => x,
    case _ => 7,
  };
  return v;
}

function main() {
  const k = 1;
  const s = match (k) {
    case 0 => "zero",
    case _ => "many",
  };
  console.log(s + "!", small(0), small(5), pick(0), pick(1), mixed(0, 9), mixed(1, 9));
}
// expect: many! 1 2 3 4 9 7
// case: match_arms_only_throw
class Oops {
  constructor() {}
}

function f(n: i64): i64 throws Oops {
  return match (n) {
    case _ => {
      throw new Oops();
    },
  };
}

function main() throws Oops {
  console.log(f(0));
}
// error: no arm of this match gives a value
// case: match_binding_borrows
type P = { name: string };
enum Box {
  Has(P),
  No,
}

function touch(b: Mut<Box>): i64 {
  b = Box.No;
  return 1;
}

function main() {
  let b = Box.Has({ name: "n" + 1 });
  const x = match (b) {
    case Has(p) => touch(b) + (p.name.length as i64),
    case No => 0,
  };
}
// error: cannot mutably lend 'b' while 'p' borrows 'b' and is used later
// case: match_binding_moves_in_loop
type Box = { s: string };
function mk(n: i64): Box | null {
  return { s: "s" + n };
}
function take(b: Box): string { return b.s; }
function main() {
  for (let i = 0; i < 3; i++) {
    match (mk(i)) {
      case Some(b) => { console.log(take(b)); },
      case None => {},
    };
  }
}
// expect: s0
// expect: s1
// expect: s2
// case: match_binding_through_ref
enum M { T(string[]), N(i64) }
function main() {
  let m = M.T(["hello" + 1]);
  const r: Ref<M> = m;
  const n = match (r) {
    case T(s) => { m = M.N(3); return s[0].length; },
    case N(_) => 0 as usize,
  };
  console.log(n);
}
// error: cannot change 'm' while 's' borrows 'm'
// case: match_block_arms
enum Shape {
  Circle(f64),
  Label(string),
  Many(i64),
}

class Oops {
  why: string;
  constructor(why: string) {
    this.why = why;
  }
}

function describe(s: Shape): string {
  const out = match (s) {
    case Circle(r) => {
      if (r > 10.0) return "big";
      const name = "circle";
      return name + " " + r;
    },
    case Label(text) => {
      let joined = "";
      for (let i = 0; i < 3; i++) {
        joined += text;
        if (joined.length > 4) return "long " + joined;
      }
      return joined;
    },
    case Many(n) => {
      let total = 0;
      let i = 0;
      while (true) {
        i++;
        if (i > n) break;
        total += i;
      }
      return "sum " + total;
    },
  };
  // A return in an arm never leaves the function.
  return "<" + out + ">";
}

function nested(a: i64, b: i64): string {
  return match (a) {
    case 0 => {
      const inner = match (b) {
        case 0 => {
          return "zero zero";
        },
        case _ => "zero " + b,
      };
      return inner + "!";
    },
    case _ => "other",
  };
}

function risky(n: i64): string throws Oops {
  const s = "kept";
  return s + match (n) {
    case 0 => {
      try {
        if (n === 0) throw new Oops("inner");
        return "unreached";
      } catch (e) {
        return "caught " + e.why;
      } finally {
        console.log("finally ran");
      }
    },
    case 1 => {
      throw new Oops("outer " + "temp");
    },
    case _ => "plain",
  };
}

function main() throws Oops {
  console.log(describe(Shape.Circle(2.0)), describe(Shape.Circle(20.0)));
  console.log(describe(Shape.Label("ab")), describe(Shape.Label("x")), describe(Shape.Many(4)));
  console.log(nested(0, 0), nested(0, 5), nested(1, 0));
  console.log(risky(0), risky(2));
  try {
    console.log(risky(1));
  } catch (e) {
    console.log("error " + e.why);
  }
  const prefix = "p";
  match (prefix + "q") {
    case "pq" => {
      console.log("statement arm");
      return;
    },
    case _ => {
      console.log("no");
    },
  }
  console.log("after", prefix);
}
// expect: <circle 2> <big>
// expect: <long ababab> <xxx> <sum 10>
// expect: zero zero! zero 5! other
// expect: finally ran
// expect: keptcaught inner keptplain
// expect: error outer temp
// expect: statement arm
// expect: after p
// case: match_closure_arms
function apply(f: () => i64): i64 {
  return f();
}

function main() {
  const n = 1;
  const h = match (n) {
    case 1 => move () => n + 1,
    case _ => move () => n + 20,
  };
  console.log(apply(h));
}
// error: unions holding functions are not supported yet
// case: match_core
enum Color {
  Red,
  Green,
  Blue,
}

type Dir = "up" | "down";

function name(c: Color): string {
  return match (c) {
    case Color.Red => "red",
    case Color.Green | Color.Blue => "cool",
  };
}

function size(n: i64): string {
  return match (n) {
    case 0 => "none",
    case 1 | 2 => "few",
    case k if k < 0 => "negative " + k,
    case _ => "many",
  };
}

function flip(d: Dir): Dir {
  return match (d) {
    case "up" => "down",
    case "down" => "up",
  };
}

function main() {
  const b = true;
  const yes = match (b) {
    case true => 1,
    case false => 0,
  };
  console.log(name(Color.Red), name(Color.Blue), size(0), size(2), size(-3), size(9), flip("up"), yes);
  const word: string = "hi" + 1;
  match (word) {
    case "hi1" => console.log("matched", word),
    case w => console.log("other", w),
  };
  const small: u8 = 7;
  const label = match (small) {
    case 7 => "seven",
    case _ => "?",
  };
  const maybe: i64 | null = null;
  const m = match (maybe) {
    case null => -1,
    case v => v,
  };
  console.log(label, m);
}
// expect: red cool none few negative -3 many down 1
// expect: matched hi1
// expect: seven -1
// case: match_enum_bare
enum Color {
  Red,
  Green,
  Blue,
}

function name(c: Color): string {
  return match (c) {
    case Red => "red",
    case Green => "green",
    case Blue => "blue",
  };
}

function main() {
  console.log(name(Color.Red), name(Color.Green), name(Color.Blue));
}
// expect: red green blue
// case: match_enum_bare_ambiguous
enum Color {
  Red,
  Green,
}

enum Light {
  Red = 10,
  Off = 11,
}

function h(x: Color | Light): string {
  return match (x) {
    case Red => "red",
    case _ => "rest",
  };
}

function main() {
  console.log(h(Light.Red));
}
// error: 'Red' is a member of 'Color' and 'Light'; name which, as 'Color.Red'
// case: match_expected_enum
enum Res<T, E> {
  Ok(T),
  Err(E),
}

function f(n: i64): Res<i64, string> {
  return match (n) {
    case 0 => Res.Ok(1),
    case _ => Res.Err("x" + n),
  };
}

function show(r: Res<i64, string>): string {
  return match (r) {
    case Ok(v) => "ok " + v,
    case Err(e) => "err " + e,
  };
}

function main() {
  const n = 3;
  const r: Res<i64, string> = n |> Res.Ok(%);
  const blk: Res<i64, string> = match (n) {
    case 3 => {
      return Res.Ok(3);
    },
    case _ => Res.Err("b"),
  };
  console.log(show(f(0)), show(f(2)), show(r), show(blk));
}
// expect: ok 1 err x2 ok 3 ok 3
// case: match_guard_changes_place
type Box = { s: string; n: i64 };
function clear(b: Mut<Box | null>): boolean { b = null; return false; }
function main() {
  let x: Box | null = { s: "hello" + "1", n: 1 };
  const r = match (x) {
    case Some({ n }) if clear(x) => "cleared",
    case Some(b) => b.s,
    case None => "none",
  };
  console.log(r);
}
// error: cannot mutably lend 'x' while a match guard is reading 'x'
// case: match_guard_moves_other
type Box = { s: string };

function take(b: Box): boolean {
  return b.s === "no";
}

function main() {
  const n = 2;
  const y: Box = { s: "a" + "b" };
  const r = match (n) {
    case 1 if take(y) => "taken",
    case _ => y.s,
  };
  console.log(r);
}
// error: 'y.s' can't be used here because 'y' was moved
// case: match_guard_moves_place
type Box = { s: string; n: i64 };
function eat(b: Box | null): boolean { return false; }
function main() {
  let x: Box | null = { s: "hello" + "1", n: 1 };
  const r = match (x) {
    case Some({ n }) if eat(x) => "ate",
    case Some(b) => b.s,
    case None => "none",
  };
  console.log(r);
}
// error: cannot move 'x' while a match guard is reading 'x'
// case: match_guard_not_cover
function main() {
  const n: i64 = 3;
  const x = match (n) {
    case k if k > 0 => 1,
  };
}
// error: this match doesn't cover every 'i64'
// case: match_guard_throws
class Oops {
  why: string;
  constructor(why: string) { this.why = why; }
}
type Box = { s: string; n: i64 };
function risky(n: i64): boolean throws Oops {
  if (n > 0) throw new Oops("boom");
  return false;
}
function main() {
  let x: Box | null = { s: "a" + "b", n: 1 };
  try {
    const r = match (x) {
      case Some({ n }) if risky(n) => "risky",
      case _ => "other",
    };
    console.log(r);
  } catch (e) {
    x = null;
    console.log("caught " + e.why);
  }
  console.log(x === null);
}
// expect: caught boom
// expect: true
// case: match_impossible
function main() {
  const n: i64 = 3;
  const x = match (n) {
    case "s" => 1,
    case _ => 2,
  };
}
// error: this pattern can never match a 'i64'
// case: match_missing_array
function count(xs: i64[]): i64 {
  return match (xs) {
    case [] => 0,
    case [_] => 1,
  };
}

function main() {
  console.log(count([]));
}
// error: this match doesn't cover every 'i64[]'; add 'case _ =>' for the rest
// case: match_missing_boolean
function f(b: boolean): i64 {
  return match (b) {
    case true => 1,
  };
}

function main() {}
// error: this match doesn't cover false; add 'case false =>', or 'case _ =>' for the rest
// case: match_missing_enum
enum Color {
  Red,
  Green,
  Blue,
}

function f(c: Color): i64 {
  return match (c) {
    case Color.Red => 1,
    case Color.Green => 2,
  };
}

function main() {}
// error: this match doesn't cover Color.Blue; add 'case Color.Blue =>', or 'case _ =>' for the rest
// case: match_missing_nested
enum Shape {
  Circle(f64),
  Rect(f64, f64),
  Empty,
}

function f(s: Shape): i64 {
  return match (s) {
    case Circle(_) => 1,
    case Rect(1.0, _) => 2,
    case Empty => 3,
  };
}

function main() {}
// error: this match doesn't cover Shape.Rect(_, _)
// case: match_missing_none
enum Shape {
  Circle(f64),
  Rect(f64, f64),
  Empty,
}

function f(o: string | null): i64 {
  return match (o) {
    case Some(x) => 1,
  };
}

function main() {}
// error: this match doesn't cover null
// case: match_missing_number
function main() {
  const n: i64 = 3;
  const x = match (n) {
    case 1 => "a",
  };
}
// error: this match doesn't cover every 'i64'; add 'case _ =>' for the rest
// case: match_missing_shape
type Shape = { kind: "circle"; r: f64 } | { kind: "rect"; w: f64; h: f64 };

function area(s: Shape): f64 {
  return match (s) {
    case { kind: "circle", r } => r,
  };
}

function main() {
  console.log(area({ kind: "circle", r: 1.0 }));
}
// error: this match doesn't cover { kind: "rect" }; add 'case { kind: "rect" } =>'
// case: match_missing_variant
enum Shape {
  Circle(f64),
  Rect(f64, f64),
  Empty,
}

function f(s: Shape): i64 {
  return match (s) {
    case Circle(_) => 1,
    case Rect(_, _) => 2,
  };
}

function main() {}
// error: this match doesn't cover Shape.Empty; add 'case Shape.Empty =>', or 'case _ =>' for the rest
// case: match_mut_field
// expect: 6 t
// expect: 6 t
// A Mut field bound by a match pattern writes through to what it points at.
type R = { m: Mut<i64>; tag: string };
function all(): string {
  let x = 1;
  let r: R = { m: x, tag: "t" };
  const label = match (r) { case { m, tag } => { m += 5; return tag; } };
  return `${x} ${label}`;
}
function main() { console.log(all()); console.log(comptime all()); }
// case: match_non_null_lends
type Box = { s: string };
type W = { b: Box };
function main() {
  let x: W | null = { b: { s: "hello" + "1" } };
  match (x!) {
    case { b } => {
      x = null;
      console.log(b.s);
    },
  };
}
// error: cannot change 'x' while 'b' borrows 'x'
// case: match_object_getter
interface HasN { n: i64; }
class G {
  k: i64;
  constructor(k: i64) { this.k = k; }
  get n(): i64 { return this.k * 10; }
}
function f(x: HasN): string {
  return match (x) { case { n: 10 } => "ten", case { n } => "n" + n };
}
function main() { console.log(f(new G(1)), f(new G(2))); }
// error: object patterns reading a field a getter provides are not supported yet
// case: match_object_impossible
type Shape = { kind: "circle"; r: f64 } | { kind: "rect"; w: f64; h: f64 };

function main() {
  const s: Shape = { kind: "circle", r: 1.0 };
  const n = match (s) {
    case { radius } => 1,
    case _ => 0,
  };
  console.log(n);
}
// error: this pattern can never match
// case: match_object_interface
interface HasA {
  a: i64;
}

class K {
  a: i64;
  constructor(a: i64) {
    this.a = a;
  }
}

function f(x: HasA): string {
  return match (x) {
    case { a: 1 } => "one",
    case { a } => "a=" + a,
  };
}

function main() {
  console.log(f(new K(1)), f(new K(4)), f({ a: 1, b: true }));
}
// expect: one a=4 one
// case: match_object_param
type W = { a: i64; c: string };

function g(w: W): string {
  return match (w) {
    case { a: 1, c } => "one " + c,
    case _ => "other",
  };
}

function h(w: Ref<W>): string {
  return match (w) {
    case { a: 2 } => "two",
    case { c } => c,
  };
}

function main() {
  const w: W = { a: 1, c: "cc" };
  const v = { a: 2, c: "dd", extra: true };
  console.log(h(w), h(v), g(w), g(v));
}
// expect: cc two one cc other
// case: match_object_shapes
class Base {
  name: string;
  constructor(name: string) { this.name = name; }
}
class Kid extends Base {
  age: i64;
  constructor(name: string, age: i64) { super(name); this.age = age; }
}
class Other {
  name: string;
  id: i64;
  constructor(name: string, id: i64) { this.name = name; this.id = id; }
}
type V = { tag: "n"; v: i64 } | { tag: "s"; v: string } | { tag: "b"; v: boolean };
function kid(k: Ref<Kid>): string {
  return match (k) {
    case { name: "bob", age } => "bob " + age,
    case { name, age: 3 } => name + " three",
    case { name } => name,
  };
}
function either(x: Ref<Kid | Other>): string {
  return match (x) {
    case { age, name } => "kid " + name + age,
    case { id } => "other " + id,
  };
}
function names(x: Kid | Other): string {
  return match (x) {
    case { name } => name,
  };
}
function vv(x: Ref<V>): string {
  return match (x) {
    case { v: 1 } => "one",
    case { v: "s" } => "ess",
    case { v: true } => "yes",
    case { tag: "s", v } => "s" + v,
    case _ => "other",
  };
}
function opts(xs: Ref<(string | null)[]>): string {
  return match (xs) {
    case [Some(a), null] => "a then none " + a,
    case [Some(a), Some(b)] => a + b,
    case _ => "?",
  };
}
function main() {
  const k = new Kid("bob", 7);
  const j = new Kid("jo", 3);
  console.log(kid(k), kid(j));
  const e1: Kid | Other = new Kid("al", 5);
  const e2: Kid | Other = new Other("ot", 9);
  console.log(either(e1), either(e2));
  console.log(names(e1), names(e2));
  const a: V = { tag: "n", v: 1 };
  const b: V = { tag: "s", v: "s" };
  const c: V = { tag: "s", v: "zz" };
  const d: V = { tag: "b", v: false };
  console.log(vv(a), vv(b), vv(c), vv(d));
  const xs: (string | null)[] = ["x", null];
  const ys: (string | null)[] = ["x", "y"];
  console.log(opts(xs), opts(ys));
}
// expect: bob 7 jo three
// expect: kid al5 other 9
// expect: al ot
// expect: one ess szz other
// expect: a then none x xy
// case: match_objects
type Shape = { kind: "circle"; r: f64 } | { kind: "rect"; w: f64; h: f64 } | { kind: "label"; text: string };

class Point {
  x: i64;
  y: i64;
  constructor(x: i64, y: i64) {
    this.x = x;
    this.y = y;
  }
}

function area(s: Ref<Shape>): f64 {
  return match (s) {
    case { kind: "circle", r } => r * r * 3.0,
    case { kind: "rect", w, h } => w * h,
    case { kind: "label" } => 0.0,
  };
}

function name(s: Shape): string {
  return match (s) {
    case { kind: "label", text } => "label " + text,
    case { kind: "circle", r: 1.0 } => "unit circle",
    case _ => "other",
  };
}

function make(n: i64): Shape {
  if (n > 0) return { kind: "label", text: "made" + n };
  return { kind: "circle", r: 2.0 };
}

function where(p: Point): string {
  return match (p) {
    case { x: 0, y: 0 } => "origin",
    case { x: 0 } => "on y",
    case { y } if y > 5 => "high",
    case _ => "elsewhere",
  };
}

function sum(xs: i64[]): i64 {
  return match (xs) {
    case [] => 0,
    case [a] => a,
    case [a, b] => a + b,
    case [_, _, c] => c * 100,
    case _ => -1,
  };
}

function first(xs: Ref<string[]>): string {
  return match (xs) {
    case [a] => "one " + a,
    case [a, "x"] => "pair " + a,
    case _ => "many",
  };
}

function main() {
  const shapes: Shape[] = [{ kind: "circle", r: 1.0 }, { kind: "rect", w: 2.0, h: 3.0 }, { kind: "label", text: "hi" }];
  for (const s of shapes) console.log(area(s));
  const label: Shape = { kind: "label", text: "kept" };
  console.log(name({ kind: "label", text: "hi" }), name({ kind: "circle", r: 1.0 }), name({ kind: "rect", w: 1.0, h: 1.0 }));
  const kept = match (label) {
    case { kind: "label", text } => text,
    case _ => "none",
  };
  console.log(kept, area(label));
  const moved = match (make(3)) {
    case { kind: "label", text } => text,
    case _ => "none",
  };
  console.log(moved);
  console.log(where(new Point(0, 0)), where(new Point(0, 3)), where(new Point(1, 9)), where(new Point(1, 1)));
  console.log(sum([]), sum([4]), sum([4, 5]), sum([1, 2, 3]), sum([1, 2, 3, 4]));
  const words = ["a", "x"];
  console.log(first(["z"]), first(words), first(["q", "y"]), words.length);
  const taken = match (["p", "q"]) {
    case [a, b] => b + a,
    case _ => "",
  };
  console.log(taken);
}
// expect: 3
// expect: 6
// expect: 0
// expect: label hi unit circle other
// expect: kept 0
// expect: made3
// expect: origin on y high elsewhere
// expect: 0 4 9 300 -1
// expect: one z pair a many 2
// expect: qp
// case: match_on_length
function main() {
  const t = "a" + "-long";
  const s = match (t.length) {
    case 0 => "",
    case _ => t + "!",
  };
  const xs = [1, 2];
  console.log(s, match (xs.length) { case 2 => "two", case _ => "other" });
}
// expect: a-long! two
// case: match_place_usable
type P = { name: string };
enum Box {
  Has(P),
  No,
}

function main() {
  let b = Box.Has({ name: "n" + 1 });
  const x = match (b) {
    case Has(p) => p.name.length,
    case No => 0,
  };
  b = Box.No;
  console.log(x);
}
// expect: 2
// case: match_several_numbers
function f(x: i32 | u8): string {
  return match (x) {
    case 5 => "five",
    case _ => "other",
  };
}

function main() {
  const v: u8 = 5;
  console.log(f(v));
}
// error: a number can't be matched against 'i32 | u8', which holds several number types
// case: match_statement_return_value
function check(n: i64): string {
  match (n) {
    case 0 => {
      return "zero";
    },
    case _ => {},
  }
  return "fell through";
}

function main() {
  console.log(check(0));
}
// error: this match's value isn't used, so a 'return' in its arm can't give one
// case: match_variant_arity
enum Shape {
  Circle(f64),
  Rect(f64, f64),
  Empty,
}

function f(s: Shape): i64 {
  return match (s) {
    case Circle(a, b) => 1,
    case _ => 2,
  };
}

function main() {}
// error: 'Shape.Circle' holds 1 value, so its pattern takes 1
// case: match_variants
enum Shape {
  Circle(f64),
  Rect(f64, f64),
  Label(string),
  Empty,
}

enum Result<T, E> {
  Ok(T),
  Err(E),
}

type P = { name: string };

function area(s: Ref<Shape>): f64 {
  return match (s) {
    case Circle(r) => r * r * 3.0,
    case Shape.Rect(w, h) => w * h,
    case Label(_) | Empty => 0.0,
  };
}

function describe(s: Shape): string {
  return match (s) {
    case Circle(r) if r > 10.0 => "big circle",
    case Circle(_) => "circle",
    case Label(text) => "label " + text,
    case Rect(w, 0.0) => "flat",
    case Rect(_, _) => "rect",
    case Empty => "empty",
  };
}

function parse(s: string): Result<i64, string> {
  if (s === "1") return Result.Ok(1);
  return Result.Err("bad " + s);
}

function make(n: i64): Shape {
  return n > 0 ? Shape.Label("made" + n) : Shape.Empty;
}

function main() {
  const shapes = [Shape.Circle(1.0), Shape.Rect(2.0, 3.0), Shape.Label("x" + 1), Shape.Empty, Shape.Circle(20.0), Shape.Rect(5.0, 0.0)];
  let total = 0.0;
  for (const s of shapes) total += area(s);
  console.log(total);
  for (const s of shapes) console.log(describe(s.clone()));
  const r = parse("1");
  const e = parse("q");
  const shown = match (e) {
    case Ok(n) => "ok " + n,
    case Err(msg) => msg,
  };
  console.log(shown, match (r) { case Ok(n) => n, case Err(_) => -1 });
  const o: string | null = "here" + 1;
  const n: i64 | null = null;
  console.log(match (o) { case Some(text) => text, case None => "none" }, match (n) { case None => "empty", case Some(v) => "has" });
  const nested: Result<Shape, string> = Result.Ok(Shape.Label("deep" + 1));
  console.log(match (nested) { case Ok(Label(t)) => t, case Ok(_) => "other", case Err(m) => m });
  const owned = match (make(3)) { case Label(t) => t, case _ => "" };
  console.log(owned, match (make(0)) { case Empty => "nothing", case _ => "?" });
  const people: P[] = [{ name: "ann" + 1 }];
  const maybe: P | null = { name: "bo" + 2 };
  console.log(match (maybe) { case Some(p) => p.name, case None => "" }, maybe !== null);
}
// expect: 1209
// expect: circle
// expect: rect
// expect: label x1
// expect: empty
// expect: big circle
// expect: flat
// expect: bad q 1
// expect: here1 empty
// expect: deep1
// expect: made3 nothing
// expect: bo2 true
// case: match_variants_release
enum Shape {
  Circle(f64),
  Rect(f64, f64),
  Label(string),
  Empty,
}

enum Result<T, E> {
  Ok(T),
  Err(E),
}

type P = { name: string };

function area(s: Ref<Shape>): f64 {
  return match (s) {
    case Circle(r) => r * r * 3.0,
    case Shape.Rect(w, h) => w * h,
    case Label(_) | Empty => 0.0,
  };
}

function describe(s: Shape): string {
  return match (s) {
    case Circle(r) if r > 10.0 => "big circle",
    case Circle(_) => "circle",
    case Label(text) => "label " + text,
    case Rect(w, 0.0) => "flat",
    case Rect(_, _) => "rect",
    case Empty => "empty",
  };
}

function parse(s: string): Result<i64, string> {
  if (s === "1") return Result.Ok(1);
  return Result.Err("bad " + s);
}

function make(n: i64): Shape {
  return n > 0 ? Shape.Label("made" + n) : Shape.Empty;
}

function main() {
  const shapes = [Shape.Circle(1.0), Shape.Rect(2.0, 3.0), Shape.Label("x" + 1), Shape.Empty, Shape.Circle(20.0), Shape.Rect(5.0, 0.0)];
  let total = 0.0;
  for (const s of shapes) total += area(s);
  console.log(total);
  for (const s of shapes) console.log(describe(s.clone()));
  const r = parse("1");
  const e = parse("q");
  const shown = match (e) {
    case Ok(n) => "ok " + n,
    case Err(msg) => msg,
  };
  console.log(shown, match (r) { case Ok(n) => n, case Err(_) => -1 });
  const o: string | null = "here" + 1;
  const n: i64 | null = null;
  console.log(match (o) { case Some(text) => text, case None => "none" }, match (n) { case None => "empty", case Some(v) => "has" });
  const nested: Result<Shape, string> = Result.Ok(Shape.Label("deep" + 1));
  console.log(match (nested) { case Ok(Label(t)) => t, case Ok(_) => "other", case Err(m) => m });
  const owned = match (make(3)) { case Label(t) => t, case _ => "" };
  console.log(owned, match (make(0)) { case Empty => "nothing", case _ => "?" });
  const people: P[] = [{ name: "ann" + 1 }];
  const maybe: P | null = { name: "bo" + 2 };
  console.log(match (maybe) { case Some(p) => p.name, case None => "" }, maybe !== null);
}
// mode: release
// expect: 1209
// expect: circle
// expect: rect
// expect: label x1
// expect: empty
// expect: big circle
// expect: flat
// expect: bad q 1
// expect: here1 empty
// expect: deep1
// expect: made3 nothing
// expect: bo2 true
