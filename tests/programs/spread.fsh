// case: spread_argument
function main() {
  print(...[1])
}
// error: '...' spreads into an array literal, or as an argument into a rest parameter
// case: spread_arrays
// expect: 1,2,3,1,2 2
// expect: 1 9 3
// expect: m1,m2,x a|€|b g1,g2
// expect: 3,1 2 k,j
// expect: 3 3
// expect: only
// Spreads of arrays (cloned, or taken over when made for the spread), strings, generators,
// Maps and Sets, typed by their elements or by the array they go into.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function* gen(): Generator<string> { yield "g" + 1; yield "g2"; }
function make(): string[] { return ["m" + 1, "m2"]; }
function main() {
  const a = [1, 2];
  const b = [...a, 3, ...a];
  console.log(b.join(), a.length);
  let ps = [new P(1), new P(2)];
  let qs = [...ps, new P(3)];
  qs[0].n = 9;
  console.log(ps[0].n, qs[0].n, qs.length);
  console.log([...make(), "x"].join(), [..."a€b"].join("|"), [...gen()].join());
  const m = new Map([["k", 1], ["j", 2]]);
  const s = new Set([3, 1, 3]);
  console.log([...s].join(), [...m].length, [...m.keys()].join());
  const bytes: u8[] = [1, 2];
  const more = [...bytes, 3];
  const ns: (i64 | null)[] = [...a, null];
  console.log(more.length, ns.length);
  const empty: string[] = [];
  console.log([...empty, "only"].join());
}
// case: spread_fixed_params
// error: a spread argument fills only a rest parameter, as in 'function f(...xs: T[])', since an array's length isn't known while compiling
function f(a: i64, b: i64): i64 { return a + b; } function main() { const xs = [1, 2]; console.log(f(...xs)); }
// case: spread_generator_moved
// error: 'g' was moved
function* gen(): Generator<i64> { yield 1; } function main() { let g = gen(); const xs = [...g]; g.next(); }
// case: spread_moves
// expect: 2 1
// A spread of a named array clones it, which stays usable and changes apart from the copy.
function main() {
  let xs = ["a" + 1];
  const ys = [...xs];
  xs.push("b");
  console.log(xs.length, ys.length);
}
// case: spread_number
// error: '...' spreads an array, a string, a generator, a Map or a Set, not 'i64'
function main() { const n = 5; console.log([...n].length); }
// case: spread_order
// expect: 1,2,3,3
// expect: 3 1 2
// expect: 1,2,0
// A spread is cloned when the literal reaches it, before a later part moves or changes it.
function eat(a: i64[]): i64 { return a.length as i64; }
function setFirst(xs: Mut<i64[]>): i64 { xs[0] = 99; return 0; }
class B { items: i64[]; constructor() { this.items = [1, 2]; } grow(this: Mut<this>): i64 { for (let i = 0; i < 100; i++) this.items.push(i); this.items = [7]; return 0; } }
function main() {
  let xs = [1, 2, 3];
  console.log([...xs, eat(xs)].join());
  let b = new B();
  const ys = [...b.items, b.grow()];
  console.log(ys.length, ys[0], ys[1]);
  let zs = [1, 2];
  console.log([...zs, setFirst(zs)].join());
}
// case: spread_push
// error: '...' spreads into an array literal, or as an argument into a rest parameter
function main() { let xs = [1]; const ys = [2, 3]; xs.push(...ys); }
// case: spread_wider
// error: type 'string' is not assignable to type 'i64'
function main() { const xs = ["a"]; const ys: i64[] = [...xs]; }
