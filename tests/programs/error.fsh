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
