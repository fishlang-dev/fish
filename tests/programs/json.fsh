// case: json_stringify
// expect: 1 -2.5 true "a\"b\\c\n\u0001é😀"
// expect: 0.30000000000000004 1e+21 null 1.5
// expect: {"x":1,"y":2} [{"x":1,"y":2},{"x":1,"y":2}] []
// expect: {"kids":[{"kids":[],"v":2},{"kids":[],"v":3}],"v":1}
// expect: {"kind":"circle","r":2.5} {"h":2,"kind":"rect","w":1}
// expect: [1,"a",false] "red"
// expect: null "x" {"a":null,"b":"x"}
// expect: {"id":7,"name":"ann","tags":["x","y"],"age":null}
// expect: {"Move":[1,2]} {"Say":"hi"} "Stop"
// expect: ["Stop",{"Say":"x"}]
// expect: 18446744073709551615 -9007199254740993
type Point = { y: i64; x: i64 };
type Tree = { v: i64; kids: Tree[] };
type Shape = { kind: "circle"; r: f64 } | { kind: "rect"; w: i64; h: i64 };
enum Color { Red = "red", Green = "green" }
@derive(Json)
class Base { constructor(public id: i64) {} }
@derive(Json)
class User extends Base {
  #secret: string = "s";
  constructor(id: i64, public name: string, public tags: string[], public age: u8 | null) { super(id); }
}
@derive(Json)
enum Cmd { Move(i64, i64), Say(string), Stop }
function main() {
  console.log(JSON.stringify(1), JSON.stringify(-2.5), JSON.stringify(true), JSON.stringify("a\"b\\c\n\u0001é😀"));
  console.log(JSON.stringify(0.1 + 0.2), JSON.stringify(1e21), JSON.stringify(0.0 / 0.0), JSON.stringify(1.5 as f32));
  const p: Point = { x: 1, y: 2 };
  const empty: i64[] = [];
  console.log(JSON.stringify(p), JSON.stringify([p.clone(), p.clone()]), JSON.stringify(empty));
  const t: Tree = { v: 1, kids: [{ v: 2, kids: [] }, { v: 3, kids: [] }] };
  console.log(JSON.stringify(t));
  const s1: Shape = { kind: "circle", r: 2.5 };
  const s2: Shape = { kind: "rect", w: 1, h: 2 };
  console.log(JSON.stringify(s1), JSON.stringify(s2));
  const tup: [i64, string, boolean] = [1, "a", false];
  console.log(JSON.stringify(tup), JSON.stringify(Color.Red));
  const o: i64 | null = null;
  const q: string | null = "x";
  console.log(JSON.stringify(o), JSON.stringify(q), JSON.stringify({ a: o, b: q }));
  console.log(JSON.stringify(new User(7, "ann", ["x", "y"], null)));
  console.log(JSON.stringify(Cmd.Move(1, 2)), JSON.stringify(Cmd.Say("hi")), JSON.stringify(Cmd.Stop));
  const cs: Cmd[] = [Cmd.Stop, Cmd.Say("x")];
  console.log(JSON.stringify(cs));
  const big: u64 = 18446744073709551615;
  console.log(JSON.stringify(big), JSON.stringify(-9007199254740993));
}
// case: json_stringify_map
// expect: {"b":[1],"a\n":[2,3]} {} {"m":{"b":[1],"a\n":[2,3]}}
function main() {
  let m = new Map<string, i64[]>();
  m.set("b", [1]);
  m.set("a\n", [2, 3]);
  m.set("c", []);
  m.delete("c");
  const e = new Map<string, boolean>();
  console.log(JSON.stringify(m), JSON.stringify(e), JSON.stringify({ m: m }));
}
// case: json_stringify_generic_and_ref
// expect: [1,2] {"x":1}
// expect: {"Add":[{"Num":1},{"Num":2}]}
// expect: "lone \ud800" 3
@derive(Json)
enum Expr { Num(i64), Add(Expr, Expr) }
function text<T>(x: T): string { return JSON.stringify(x); }
function viaRef(p: Ref<{ x: i64 }>): string { return JSON.stringify(p); }
function main() {
  const xs = [1, 2];
  console.log(text(xs.clone()), viaRef({ x: 1 }));
  console.log(JSON.stringify(Expr.Add(Expr.Num(1), Expr.Num(2))));
  console.log(JSON.stringify("lone \ud800"), xs.length + 1);
}
// case: json_set
// error: values of type 'Set<i64>' can't be written as JSON: a Set has no JSON form; write an array of its members
function main() {
  const s = new Set<i64>();
  console.log(JSON.stringify(s));
}
// case: json_number_keys
// error: only a Map with string keys has a JSON form, an object
function main() {
  const m = new Map<i64, string>();
  console.log(JSON.stringify(m));
}
// case: json_class_without_derive
// error: values of type 'P' can't be written as JSON: a class is written as JSON when it has '@derive(Json)', which 'P' doesn't
class P { x: i64 = 1; }
function main() {
  console.log(JSON.stringify({ p: new P() }));
}
// case: json_enum_without_derive
// error: an enum holding values is written as JSON when it has '@derive(Json)', which 'E' doesn't
enum E { A(i64), B }
function main() {
  const e: E = E.B;
  console.log(JSON.stringify(e));
}
// case: json_function_value
// error: can't be written as JSON: it has no JSON form
function main() {
  const f = (x: i64) => x;
  console.log(JSON.stringify(f));
}
// case: json_stringify_indent
// error: 'JSON.stringify' replacer and indent arguments are not supported yet
function main() {
  console.log(JSON.stringify([1], null, 2));
}
// case: json_derive_with_macro
// expect: {"x":1} true
macro function keep(input: Ast): Ast { return input; }
@keep @derive(Json, Eq)
class P { constructor(public x: i64) {} }
function main() {
  console.log(JSON.stringify(new P(1)), new P(1) === new P(1));
}
