// case: error_subclass_and_cause
// expect: 1
// expect: Error zero
// expect: NotFound negative 404
// expect: outer NotFound inner
// expect: 0 Error
class NotFound extends Error {
  code: i64;
  constructor(message: string, code: i64) {
    super(message);
    this.code = code;
    this.name = "NotFound";
  }
}
function find(n: i64): i64 throws NotFound | Error {
  if (n === 0) throw new Error("zero");
  if (n < 0) throw new NotFound("negative", 404);
  return n;
}
function main() {
  for (const n of [1, 0, -1]) {
    try {
      console.log(find(n));
    } catch (e) {
      if (e instanceof NotFound) console.log(e.name, e.message, e.code);
      else console.log(e.name, e.message);
    }
  }
  const inner = new NotFound("inner", 1);
  const outer = new Error("outer", { cause: inner });
  const c = outer.cause;
  if (c !== null) console.log(outer.message, c.name, c.message);
  const plain = new Error();
  console.log(plain.message.length, plain.name);
}
// case: error_dyn_field_boxed
// expect: x x -
interface I { name: string }
class X { name: string = "x"; }
function f(o: { c?: Dyn<I> }): string {
  const c = o.c;
  if (c === null) return "-";
  return c.name;
}
function main() {
  const o: { c: Dyn<I> } = { c: new X() };
  console.log(o.c.name, f({ c: new X() }), f({}));
}
// case: error_cause_not_error_like
// error: type '{ x: i64 }' is not assignable to type 'Dyn<ErrorLike>'
function main() {
  const e = new Error("outer", { cause: { x: 1 } });
}
// case: error_aggregate
// expect: [AggregateError: All promises were rejected] {
// expect:   [errors]: [ [Boom: a], [Boom: b] ]
// expect: }
// expect: AggregateError All promises were rejected 2
class Boom extends Error {
  constructor(m: string) { super(m); this.name = "Boom"; }
}
async function fail(ms: i64, m: string): Promise<string> throws Boom {
  await sleep(ms);
  throw new Boom(m);
}
async function main() {
  try {
    await Promise.any([fail(2, "a"), fail(1, "b")]);
  } catch (e) {
    console.log(e);
    console.log(e.name, e.message, e.errors.length);
  }
}
// case: error_instanceof_subclass
// expect: true true true true
class P { m: string; constructor(m: string) { this.m = m; } }
class C extends P { constructor(m: string) { super(m); } }
class D extends C { constructor() { super("d"); } }
function main() {
  const d = new D();
  const c = new C("c");
  console.log(d instanceof C, d instanceof P, c instanceof P, d instanceof D);
}
// case: error_null_cause
// expect: [Error: x] { [cause]: [Error: root] }
function main() {
  const inner = new Error("in", { cause: new Error("root") });
  const e = new Error("x", { cause: inner.cause });
  console.log(e);
}
// case: error_name_after_super
// expect: [A: a] { code: 1 }
class A extends Error { code: i64; constructor(m: string) { super(m); this.name = "A"; this.code = 1; } }
function main() { console.log(new A("a")); }
// case: error_depth
// expect: Map(1) { 'a' => [Error: in map] }
// expect: { a: { b: { c: [Error: deep] } } }
// expect: { a: { b: { c: [NotFound [Error]: deep] } } }
// expect: { a: { b: { c: [Object] } } }
// expect: [ [ [ [Error: x] ] ] ]
// expect: [ [ [ [Array] ] ] ]
// expect: {
// expect:   a: [Coded [Error]: c] { code: 1, tags: [ 'a', 'b' ] },
// expect:   b: [Coded [Error]: d] {
// expect:     code: 2,
// expect:     tags: [ 'a', 'b' ],
// expect:     [cause]: [NotFound [Error]: q]
// expect:   }
// expect: }
// expect: [
// expect:   [Error: a],
// expect:   [Error: b],
// expect:   [Error: c],
// expect:   [Error: d],
// expect:   [Error: e],
// expect:   [Error: f],
// expect:   [Error: g]
// expect: ]
// expect: [
// expect:   [Coded [Error]: long message here] { code: 1, tags: [ 'a', 'b' ] },
// expect:   [Coded [Error]: another long message] { code: 2, tags: [ 'a', 'b' ] }
// expect: ]
// expect: [Coded [Error]: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx] {
// expect:   code: 3,
// expect:   tags: [ 'a', 'b' ]
// expect: }
// expect: str [Error: x] 1
// expect: tpl
// expect: Error
// expect: []
class NotFound extends Error { constructor(m: string) { super(m); } }
class Coded extends Error {
  code: i64;
  tags: string[];
  constructor(m: string, code: i64, options?: ErrorOptions) { super(m, options); this.code = code; this.tags = ["a", "b"]; }
}
function main() {
  let m = new Map<string, Error>();
  m.set("a", new Error("in map"));
  console.log(m);
  console.log({ a: { b: { c: new Error("deep") } } });
  console.log({ a: { b: { c: new NotFound("deep") } } });
  console.log({ a: { b: { c: { d: new Error("deeper") } } } });
  console.log([[[new Error("x")]]]);
  console.log([[[[new Error("x")]]]]);
  console.log({ a: new Coded("c", 1), b: new Coded("d", 2, { cause: new NotFound("q") }) });
  console.log([new Error("a"), new Error("b"), new Error("c"), new Error("d"), new Error("e"), new Error("f"), new Error("g")]);
  console.log([new Coded("long message here", 1), new Coded("another long message", 2)]);
  console.log(new Coded("x".repeat(100), 3));
  console.log("str", new Error("x"), 1);
  console.log(`${new Error("tpl").message}`);
  console.log(String(new Error("s").name));
  const xs: Error[] = [];
  console.log(xs);
}
// case: error_multiline
// expect: {
// expect:   a: [Error: line1
// expect:   line2]
// expect: }
// expect: [
// expect:   [Error: l1
// expect:   l2],
// expect:   1
// expect: ]
// expect: [C [Error]: x
// expect: y] {
// expect:   code: 1
// expect: }
// expect: {
// expect:   a: {
// expect:     b: [C [Error]: p
// expect:     q] {
// expect:       code: 1
// expect:     }
// expect:   }
// expect: }
// expect: [Error: o] {
// expect:   [cause]: [Error: c1
// expect:   c2]
// expect: }
// expect: [
// expect:   [
// expect:     [Error: deep
// expect:     msg]
// expect:   ]
// expect: ]
class C extends Error { code: i64; constructor(m: string) { super(m); this.code = 1; } }
function main() {
  console.log({ a: new Error("line1\nline2") });
  console.log([new Error("l1\nl2"), 1]);
  console.log(new C("x\ny"));
  console.log({ a: { b: new C("p\nq") } });
  console.log(new Error("o", { cause: new Error("c1\nc2") }));
  console.log([[new Error("deep\nmsg")]]);
  const m = new Map<string, Error>();
}
