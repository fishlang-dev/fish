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
// error: values of type 'Set<i64>' can't be written as JSON: a Set has no JSON form; use an array of its members
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
// case: json_parse
// expect: 1 -2
// expect: 3 2
// expect: error: missing field 'y' at $
// expect: error: expected i64 at $.x
// expect: error: Unexpected token } in JSON at position 16
// expect: error: Unexpected non-whitespace character after JSON at position 17
// expect: error: 1.5 doesn't fit i64 at $.x
// expect: 100 2
// expect: error: 99999999999999999999 doesn't fit i64 at $.x
// expect: error: Unexpected end of JSON input
// expect: error: expected object at $
// expect: 1 none 3 3 a
// expect: é😀 255
// expect: error: 256 doesn't fit u8 at $
type Point = { x: i64; y: i64 };
type Opt = { a: i64; b?: string };
function show(s: string) {
  try {
    const p = JSON.parse<Point>(s);
    console.log(p.x, p.y);
  } catch (e) {
    console.log("error:", e.message);
  }
}
function main() {
  show("{\"x\": 1, \"y\": -2}");
  show(" { \"y\":2,\"z\":[1,{\"q\":null}],\"x\":3 } ");
  show("{\"x\": 1}");
  show("{\"x\": \"1\", \"y\": 2}");
  show("{\"x\": 1, \"y\": 2,}");
  show("{\"x\": 1, \"y\": 2} x");
  show("{\"x\": 1.5, \"y\": 2}");
  show("{\"x\": 1e2, \"y\": 2}");
  show("{\"x\": 99999999999999999999, \"y\": 2}");
  show("");
  show("[1, 2]");
  try {
    const o = JSON.parse<Opt>("{\"a\": 1}");
    const n = JSON.parse<i64[]>("[1, 2, 3]");
    const s = JSON.parse<string>("\"a\\n\\u00e9\\ud83d\\ude00\"");
    const b = JSON.parse<u8>("255");
    console.log(o.a, o.b ?? "none", n.length, n[2], s, b);
    const bad = JSON.parse<u8>("256");
    console.log(bad);
  } catch (e) {
    console.log("error:", e.message);
  }
}
// case: json_parse_composites
// expect: {"kids":[{"kids":[],"v":2},{"kids":[{"kids":[],"v":4}],"v":3}],"v":1}
// expect: [{"h":2,"kind":"rect","w":1},{"kind":"circle","r":2.5}]
// expect: {"id":7,"name":"ann","tags":["x"],"age":null} true
// expect: ["Stop",{"Say":"hi"},{"Move":[1,2]}]
// expect: {"Add":[{"Num":1},{"Add":[{"Num":2},{"Num":3}]}]}
// expect: [1,"a",true]
// expect: {"b":[4],"a":[2,3]} 2
// expect: [1,"two",null]
// expect: 18446744073709551615 -9223372036854775808 1.5
type Tree = { v: i64; kids: Tree[] };
type Shape = { kind: "circle"; r: f64 } | { kind: "rect"; w: i64; h: i64 };
@derive(Json, Eq)
class Base { constructor(public id: i64) {} }
@derive(Json, Eq)
class User extends Base {
  constructor(id: i64, public name: string, public tags: string[], public age: u8 | null) { super(id); }
}
@derive(Json)
enum Cmd { Move(i64, i64), Say(string), Stop }
@derive(Json)
enum Expr { Num(i64), Add(Expr, Expr) }
function main() {
  try {
    const t = JSON.parse<Tree>("{\"v\":1,\"kids\":[{\"v\":2,\"kids\":[]},{\"v\":3,\"kids\":[{\"v\":4,\"kids\":[]}]}]}");
    console.log(JSON.stringify(t));
    const shapes = JSON.parse<Shape[]>("[{\"kind\":\"rect\",\"w\":1,\"h\":2},{\"r\":2.5,\"kind\":\"circle\"}]");
    console.log(JSON.stringify(shapes));
    const u = JSON.parse<User>("{\"id\":7,\"name\":\"ann\",\"tags\":[\"x\"],\"age\":null,\"extra\":{\"deep\":[1,2]}}");
    console.log(JSON.stringify(u), u === new User(7, "ann", ["x"], null));
    const cs = JSON.parse<Cmd[]>("[\"Stop\",{\"Say\":\"hi\"},{\"Move\":[1,2]}]");
    console.log(JSON.stringify(cs));
    const ex = JSON.parse<Expr>("{\"Add\":[{\"Num\":1},{\"Add\":[{\"Num\":2},{\"Num\":3}]}]}");
    console.log(JSON.stringify(ex));
    const tup = JSON.parse<[i64, string, boolean]>("[1, \"a\", true]");
    console.log(JSON.stringify(tup));
    const m = JSON.parse<Map<string, i64[]>>("{\"b\":[1],\"a\":[2,3],\"b\":[4]}");
    console.log(JSON.stringify(m), m.size);
    const mixed = JSON.parse<(i64 | string | null)[]>("[1, \"two\", null]");
    console.log(JSON.stringify(mixed));
    const big = JSON.parse<u64>("18446744073709551615");
    const neg = JSON.parse<i64>("-9223372036854775808");
    const fl = JSON.parse<f32>("1.5");
    console.log(big, neg, fl);
  } catch (e) {
    console.log("error:", e.message);
  }
}
// case: json_parse_failures
// expect: expected i64 at $.inner.n
// expect: expected string at $.tags[2]
// expect: Unexpected end of JSON input
// expect: Unexpected non-whitespace character after JSON at position 50
// expect: Unexpected token x in JSON at position 11
// expect: expected f64 at $[1].r
// expect: expected "rect" at $[0].kind
// expect: expected an array of 2 at $[2].Move
// expect: expected one of Move, Say, Stop at $[0]
// expect: expected an object of one key at $[0].Say
// expect: expected string at $.b[1]
// expect: expected an array of 2 at $
// expect: expected an array of 2 at $
// expect: expected string at $[1]
type Shape = { kind: "circle"; r: f64 } | { kind: "rect"; w: i64; h: i64 };
type P = { name: string; tags: string[]; inner: { s: string; n: i64 } };
@derive(Json)
enum Cmd { Move(i64, i64), Say(string), Stop }
function tryP(s: string) {
  try {
    const p = JSON.parse<P>(s);
    console.log("ok", p.name);
  } catch (e) {
    console.log(e.message);
  }
}
function tryShapes(s: string) {
  try {
    const p = JSON.parse<Shape[]>(s);
    console.log("ok", p.length);
  } catch (e) {
    console.log(e.message);
  }
}
function tryCmd(s: string) {
  try {
    const p = JSON.parse<Cmd[]>(s);
    console.log("ok", p.length);
  } catch (e) {
    console.log(e.message);
  }
}
function tryMap(s: string) {
  try {
    const p = JSON.parse<Map<string, string[]>>(s);
    console.log("ok", p.size);
  } catch (e) {
    console.log(e.message);
  }
}
function tryTuple(s: string) {
  try {
    const p = JSON.parse<[string, string]>(s);
    console.log("ok", p[0]);
  } catch (e) {
    console.log(e.message);
  }
}
function main() {
  tryP("{\"name\":\"a\",\"name\":\"b\",\"tags\":[\"x\",\"y\"],\"inner\":{\"s\":\"q\",\"n\":\"bad\"}}");
  tryP("{\"name\":\"a\",\"tags\":[\"x\",\"y\", 3],\"inner\":{\"s\":\"q\",\"n\":1}}");
  tryP("{\"name\":\"a\",\"tags\":[\"x\"],\"inner\":{\"s\":\"q\",\"n\":1}");
  tryP("{\"name\":\"a\",\"tags\":[\"x\"],\"inner\":{\"s\":\"q\",\"n\":1}} [");
  tryP("{\"name\":\"a\\x\"}");
  tryShapes("[{\"kind\":\"rect\",\"w\":1,\"h\":2},{\"kind\":\"circle\",\"r\":\"x\"}]");
  tryShapes("[{\"kind\":\"square\",\"w\":1}]");
  tryCmd("[\"Stop\",{\"Say\":\"hi\"},{\"Move\":[1]}]");
  tryCmd("[\"Go\"]");
  tryCmd("[{\"Say\":\"a\",\"Stop\":null}]");
  tryMap("{\"a\":[\"x\"],\"b\":[\"y\",1]}");
  tryTuple("[\"a\",\"b\",\"c\"]");
  tryTuple("[\"a\"]");
  tryTuple("[\"a\", 1]");
}
// case: json_parse_generic_and_throws
// expect: 12
// expect: 2
function f(): i64 throws JsonError { return JSON.parse<i64>("12"); }
function read<T>(s: string): T throws JsonError { return JSON.parse<T>(s); }
function main() {
  try {
    console.log(f());
    const xs: i64[] = read<i64[]>("[1,2]");
    console.log(xs.length);
  } catch (e) {
    console.log(e.message);
  }
}
// case: json_parse_uncaught
// error: 'main' must declare 'throws JsonError' after its return type since 'JSON.parse' can throw 'JsonError', or catch it with try/catch
function main() {
  const x = JSON.parse<i64>("1");
  console.log(x);
}
// case: json_parse_untyped
// error: 'JSON.parse' reads into the type it's given, as in 'JSON.parse<User>(s)'; the dynamic Json value, for data without a type, isn't supported yet
function main() {
  const x = JSON.parse("1");
}
// case: json_parse_private_fields
// error: a class with '#private' fields can't be read from JSON, since JSON doesn't hold them
@derive(Json)
class P { #s: string = "a"; x: i64 = 1; }
function main() {
  try { JSON.parse<P>("{}"); } catch (e) {}
}
// case: json_parse_not_string
// error: 'JSON.parse' reads a string, not 'i64'
function main() {
  try { JSON.parse<i64>(1); } catch (e) {}
}
// case: json_parse_class_without_derive
// error: a class is read from JSON when it has '@derive(Json)', which 'P' doesn't
class P { x: i64 = 1; }
function main() {
  try { JSON.parse<P>("{}"); } catch (e) {}
}
// case: json_http
// expect: HTTP/1.1 200 OK|content-type: application/json|{"id":7,"name":"ann"}
// expect: HTTP/1.1 201 Created|content-type: application/json|{"id":8,"name":"bo"}
// expect: HTTP/1.1 400 Bad Request|content-type: text/plain;charset=UTF-8|missing field 'name' at $
@derive(Json)
class User { constructor(public id: i64, public name: string) {} }
type NewUser = { name: string };
async function ask(port: i64, raw: string): Promise<string> throws IoError {
  const conn = await TcpStream.connect("127.0.0.1", port);
  await conn.write(new TextEncoder().encode(raw));
  let all: u8[] = [];
  while (true) {
    const got = await conn.read(4096);
    if (got.length === 0) break;
    for (const b of got) all.push(b);
  }
  return new TextDecoder().decode(all);
}
function line(text: string): string {
  const parts = text.split("\r\n\r\n");
  const head = parts[0].split("\r\n");
  const typed = head.filter((h) => h.toLowerCase().startsWith("content-type:"));
  return head[0] + "|" + (typed.length > 0 ? typed[0] : "") + "|" + parts[1].trim();
}
async function main(): Promise<void> throws IoError {
  let app = new Router();
  app.get("/users/:id", async (req) => Response.json(new User(7, "ann")));
  app.post("/users", async (req) => {
    try {
      const made = await req.json<NewUser>();
      return Response.json({ id: 8, name: made.name }, { status: 201 });
    } catch (e) {
      return new Response(e.message, { status: 400 });
    }
  });
  const found = shared({ port: new Atomic(0) });
  const seen = found.clone();
  spawn(serve({ port: 0, hostname: "127.0.0.1", onListen: (info) => { seen.port.store(info.port); } }, app.handler()));
  while (found.port.load() === 0) await sleep(1);
  const port = found.port.load();
  const a = await ask(port, "GET /users/7 HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n");
  console.log(line(a));
  const b = await ask(port, "POST /users HTTP/1.1\r\nHost: h\r\nContent-Length: 13\r\nConnection: close\r\n\r\n{\"name\":\"bo\"}");
  console.log(line(b));
  const c = await ask(port, "POST /users HTTP/1.1\r\nHost: h\r\nContent-Length: 9\r\nConnection: close\r\n\r\n{\"nom\":1}");
  console.log(line(c));
}
// case: json_parse_enum_in_union
// expect: {"Circle":2} "Dot" null
// expect: error: expected one of Circle, Dot at $
// expect: {"Circle":2} {"s":{"Circle":3}}
@derive(Json)
enum Shape { Circle(f64), Dot }
type H = { s?: Shape };
function one(s: string): string {
  try {
    const a = JSON.parse<Shape | null>(s);
    return JSON.stringify(a);
  } catch (e) {
    return "error: " + e.message;
  }
}
function main() {
  console.log(one("{\"Circle\":2}"), one("\"Dot\""), one("null"));
  console.log(one("{}"));
  try {
    const a = JSON.parse<Shape | string>("{\"Circle\":2}");
    const h = JSON.parse<H>("{\"s\":{\"Circle\":3}}");
    console.log(JSON.stringify(a), JSON.stringify(h));
  } catch (e) {
    console.log(e.message);
  }
}
// case: json_parse_statement
// expect: fine
// expect: Unexpected token x in JSON at position 0
function check(s: string): string {
  try {
    JSON.parse<string[]>(s);
    return "fine";
  } catch (e) {
    return e.message;
  }
}
function main() {
  console.log(check("[\"a\", \"b\"]"));
  console.log(check("x"));
}
// case: json_parse_union_messages
// expect: expected null | u8 at $.age
// expect: 300 doesn't fit u8 at $.age
// expect: expected i64 | string at $.n
// expect: expected N at $
type U = { age?: u8; n: i64 | string };
enum N { One = 1, Two = 2 }
function t(s: string): string {
  try {
    JSON.parse<U>(s);
    return "ok";
  } catch (e) {
    return e.message;
  }
}
function main() {
  console.log(t("{\"age\":\"x\",\"n\":1}"));
  console.log(t("{\"age\":300,\"n\":1}"));
  console.log(t("{\"n\":true}"));
  try {
    JSON.parse<N>("3");
  } catch (e) {
    console.log(e.message);
  }
}
// case: json_parse_literal_union
// expect: expected "a" | "b" at $.f
// expect: expected "a" | "b" at $.f
type F = { f: "a" | "b" };
function t(s: string): string {
  try {
    JSON.parse<F>(s);
    return "ok";
  } catch (e) {
    return e.message;
  }
}
function main() {
  console.log(t("{\"f\":\"c\"}"));
  console.log(t("{\"f\": \"c\"}"));
}
