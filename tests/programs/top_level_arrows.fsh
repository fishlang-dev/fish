// case: top_level_arrow_forms
// expect: 11 22 120 3
// expect: 6 3
// expect: HI
// expect: 6 2 g
// A top-level const holding an arrow is a function: written or inferred results, block bodies,
// async, defaults, generics, recursion through its name, and other top-level names read inside.
const K = 10;
function twice(x: i64): i64 {
  return x * 2;
}
const addK = (x: i64) => x + K;
const both = (x: i64): i64 => twice(addK(x));
const fact = (n: i64): i64 => n <= 1 ? 1 : n * fact(n - 1);
const block = (s: string) => {
  const t = s + "!";
  return t.length;
};
const later = async (n: i64): Promise<i64> => n * 3;
const laterInferred = async (n: i64) => n + 1;
const shout = (s: string): void => {
  console.log(s.toUpperCase());
};
const withDefault = (a: i64, b: i64 = 5) => a + b;
const id = <T>(x: T): T => x;
async function main() {
  console.log(addK(1), both(1), fact(5), block("ab"));
  const l = await later(2);
  const m = await laterInferred(2);
  console.log(l, m);
  shout("hi");
  console.log(withDefault(1), withDefault(1, 1), id("g"));
}
// case: top_level_arrow_values
// expect: [ 11, 12, 13 ]
// expect: 24 10
// expect: 200 hello fish
// An arrow const passes and stores like a declared function.
const addK = (x: i64) => x + 10;
const fact = (n: i64): i64 => n <= 1 ? 1 : n * fact(n - 1);
const hello = async (req: Request) => new Response("hello " + req.param("name"));
async function main(): Promise<void> {
  console.log([1, 2, 3].map(addK));
  const g = fact;
  const holder = { f: addK };
  console.log(g(4), holder.f(0));
  let app = new Router();
  app.get("/:name", hello);
  const res = await app.handle(new Request("http://h/fish"));
  const body = await res.text();
  console.log(res.status, body);
}
// case: top_level_arrow_typed
// expect: 2 4 x7
// expect: caught 9
// A const's function type gives the arrow the types it leaves unwritten, alias or written out.
type Twice = (x: i64) => i64;
class TooBig {
  message: string = "too big";
}
const inc: (x: i64) => i64 = (x) => x + 1;
const double: Twice = (x) => x * 2;
const tag: (x: i64) => string = (x: i64) => `x${x}`;
const small: (x: i64) => i64 throws TooBig = (x) => {
  if (x > 5) throw new TooBig();
  return x;
};
function main() {
  console.log(inc(1), double(2), tag(7));
  try {
    small(9);
  } catch (e) {
    console.log("caught", 9);
  }
}
// case: top_level_arrow_type_mismatch
// error: type '(x: i64) => i64' is not assignable to type '(x: string) => i64'
const f: (x: string) => i64 = (x: i64) => x + 1;
function main() {
  console.log(f(1));
}
// case: top_level_arrow_result_mismatch
// error: type 'i64' is not assignable to return type 'string'
const f: (x: i64) => string = (x) => x + 1;
function main() {
  console.log(f(1));
}
// case: top_level_arrow_not_function
// error: type '(x: i64) => i64' is not assignable to type 'i64'
const f: i64 = (x: i64) => x + 1;
function main() {
  console.log(f(1));
}
// case: top_level_generic_arrow_typed
// error: a const holding a generic arrow takes its type from the arrow; drop the const's written type
const f: <T>(x: T) => T = <T>(x: T) => x;
function main() {
  console.log(f(1));
}
// case: top_level_let_arrow
// error: a top-level 'let' would be a global that changes
let f = (x: i64) => x + 1;
function main() {
  console.log(f(1));
}
// case: top_level_const_function_value
// error: a top-level const holding a function is supported when its value is an arrow written in place
function twice(x: i64): i64 {
  return x * 2;
}
const f = twice;
function main() {}
// case: top_level_const_called
// error: 'f' is a top-level const, and calling a function value one holds isn't supported yet
const o = { f: (x: i64) => x + 1 };
const f = o.f;
function main() {
  console.log(f(1));
}
