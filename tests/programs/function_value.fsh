// case: function_value_forms
// expect: 10 [ 2, 4, 6, 8 ] [ 2, 4 ]
// expect: 20
// expect: 14
// expect: [ 6, 4 ]
// expect: 42
// expect: 5
// A declared function named as a value is a closure calling it.
function double(x: i64): i64 { return x * 2; }
function isEven(x: i64): boolean { return x % 2 === 0; }
function apply(f: (x: i64) => i64, v: i64): i64 { return f(v); }
function sum(...xs: i64[]): i64 { let t = 0; for (const x of xs) t += x; return t; }
function pick(): (x: i64) => i64 { return double; }
async function later(x: i64): Promise<i64> { return x + 1; }
type Handlers = { onNumber: (x: i64) => i64 };
async function main(): Promise<void> {
  const xs = [1, 2, 3, 4];
  console.log(apply(double, 5), xs.map(double), xs.filter(isEven));
  const f = double;
  console.log(f(10));
  const h: Handlers = { onNumber: double };
  console.log(h.onNumber(7));
  const fs: ((x: i64) => i64)[] = [double, (x: i64): i64 => x + 1];
  console.log(fs.map((g) => g(3)));
  console.log(pick()(21));
  const l = later;
  const v = await l(4);
  console.log(v);
}
// case: function_value_callbacks
// expect: [ 'BOB!', 'AL!', 'CHRISTINE!' ]
// expect: [ 5, 25 ]
// expect: [ 'a', 'bb', 'ccc' ]
type Point = { x: i64; y: i64 };
function shout(s: string): string { return s.toUpperCase() + "!"; }
function norm(p: Point): i64 { return p.x * p.x + p.y * p.y; }
function byLength(a: string, b: string): i64 { return (a.length as i64) - (b.length as i64); }
function main(): void {
  const names = ["bob", "al", "christine"];
  console.log(names.map(shout));
  const pts: Point[] = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
  console.log(pts.map((p) => norm(p.clone())));
  let sorted = ["ccc", "a", "bb"];
  sorted.sort(byLength);
  console.log(sorted);
}
// case: function_value_lent_element
// error: 'map' lends its callback each element as a 'Ref<{ x: i64; y: i64 }>', and 'norm' takes its own '{ x: i64; y: i64 }'; write '(x) => norm(x.clone())'
type Point = { x: i64; y: i64 };
function norm(p: Point): i64 { return p.x * p.x + p.y * p.y; }
function main(): void { const pts: Point[] = [{ x: 1, y: 2 }]; console.log(pts.map(norm)); }
// case: function_value_generic
// error: 'id' is generic, a family of functions made one per call, so it can only be called here
function id<T>(x: T): T { return x; }
function main(): void { const f = id; }
// case: function_value_throws
// error: functions that throw used as values are not supported yet
function t(n: i64): i64 throws i64 { if (n > 0) throw n; return 0; }
function main(): void { const f = t; }
// case: function_value_rest
// error: functions with rest parameters used as values are not supported yet
function s(...xs: i64[]): i64 { return 0; }
function main(): void { const f = s; }
// case: function_value_default
// error: functions with defaulted parameters used as values are not supported yet
function d(x: i64 = 1): i64 { return x; }
function main(): void { const f = d; }
// case: function_value_c
// error: C functions used as values are not supported yet
declare function abs(x: i32): i32;
function main(): void { const f = abs; }
// case: function_value_shadowed
// expect: 7
// A local of the same name is that local.
function seven(): i64 { return 0; }
function main(): void { const seven = (): i64 => 7; const f = seven; console.log(f()); }
