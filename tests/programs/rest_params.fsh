// expect: 0 1 6 6 16 3
// expect: a: b:x,y1 c:p,q
// expect: 2 1 0
// expect: 2 1 3 0
// Rest parameters on functions, generic functions, constructors, methods and statics, filled by
// trailing arguments and spread arguments.
class P { n: i64; constructor(n: i64) { this.n = n; } }
function sum(...xs: i64[]): i64 { let t = 0; for (const x of xs) t += x; return t; }
function tagged(label: string, ...rest: string[]): string { return label + ":" + rest.join(","); }
function count<T>(...xs: T[]): usize { return xs.length; }
class Bag { items: P[]; constructor(...items: P[]) { this.items = items; } add(...more: P[]): usize { return more.length; } static of(...ns: i64[]): usize { return ns.length; } }
function main() {
  const xs = [1, 2, 3];
  console.log(sum(), sum(1), sum(1, 2, 3), sum(...xs), sum(0, ...xs, 10), xs.length);
  console.log(tagged("a"), tagged("b", "x", "y" + 1), tagged("c", ...["p", "q"]));
  console.log(count(1, 2), count("a"), count<string>());
  const b = new Bag(new P(1), new P(2));
  console.log(b.items.length, b.add(new P(3)), Bag.of(1, 2, 3), new Bag().items.length);
}
