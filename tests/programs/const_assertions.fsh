// case: const_assertion_strings
// expect: b 3
// expect: a
// expect: b
// expect: c
// expect: true a!,b!,c!
// An array of string literals is an array of their union, which `typeof X[number]` names.
const KINDS = ["a", "b", "c"] as const;
type Kind = typeof KINDS[number];
function main() {
  const k: Kind = "b";
  console.log(k, KINDS.length);
  for (const x of KINDS) console.log(x);
  console.log(KINDS.includes("c"), KINDS.map((x) => x + "!").join(","));
}
// case: const_assertion_union_checked
// error: type '"d"' is not assignable to type '"a" | "b" | "c"'
// The union a const array gives keeps out other strings.
const KINDS = ["a", "b", "c"] as const;
type Kind = typeof KINDS[number];
function main() {
  const k: Kind = "d";
  console.log(k);
}
// case: const_assertion_objects
// expect: 1 -2 true n 2
// expect: 0
// An object's fields keep their literal types, nested objects and arrays too, and
// `typeof X[keyof typeof X]` is the union of its values.
const OP = { match: 0, char: 1, any: -2 } as const;
const NESTED = { inner: { on: true, name: `n` }, list: ["p", "q"] } as const;
type Op = typeof OP[keyof typeof OP];
function main() {
  const op: Op = 1;
  console.log(op, OP.any, NESTED.inner.on, NESTED.inner.name, NESTED.list.length);
  const zero: Op = OP.match;
  console.log(zero);
}
// case: const_assertion_readonly
// error: cannot assign to 'a' because it is a read-only property
// An `as const` object's fields are readonly, even in a `let`.
function main() {
  let o = { a: 1 } as const;
  o.a = 1;
  console.log(o.a);
}
// case: const_assertion_pairs
// expect: SIGINT 130
// expect: SIGTERM 143
// expect: SIGINT
// Tuples of literals in an array join position by position, so the array iterates and
// destructures, and its elements' positions are typed.
const SIGNALS = [["SIGINT", 130], ["SIGTERM", 143]] as const;
type Signal = typeof SIGNALS[number][0];
function first(s: Signal): string { return s; }
function main() {
  for (const [s, code] of SIGNALS) console.log(s, code);
  console.log(first("SIGINT"));
}
// case: const_assertion_tuples
// expect: 2 x x
// expect: true false
// expect: 2 ab
// A mixed array is a tuple of its literals, and other values in one keep their types;
// `T[number]` on a tuple is the union of its elements.
const PAIR = [1, "x"] as const;
type Part = typeof PAIR[number];
function main() {
  const [n, t] = PAIR;
  const q: Part = "x";
  console.log(n + 1, t, q);
  const fold = true;
  const saved = [fold, false] as const;
  const [a, b] = saved;
  console.log(a, b);
  const one = 1;
  const s: string = "a";
  const m = new Map([[one, s] as const, [one + 1, "a" + "b"] as const]);
  console.log(one + 1, m.get(2)!);
}
// case: const_assertion_literal
// expect: stmt 2
// A single literal keeps its literal type, as a field of an object written without one.
type Tagged = { sort: "stmt"; n: i64 } | { sort: "expr"; n: i64 };
function main() {
  const tag = { sort: "stmt" as const, n: 2 };
  const held: Tagged = tag;
  console.log(held.sort, held.n);
}
// case: const_assertion_not_literal
// error: a 'const' assertion can only be applied to an enum member, or a string, number, boolean, array or object literal
function main() {
  const x = 1;
  const y = x as const;
  console.log(y);
}
// case: const_assertion_negative_numbers
// expect: [ 1, -2, 3 ] -2 -1
// expect: 2 2
// A union of integer literals holding a negative one, baked at the top level and run by comptime.
const N = [1, -2, 3] as const;
type T = typeof N[number];
function sum(): i64 { const xs = [1, -2, 3] as const; let s = 0; for (const x of xs) s += x; return s; }
const S = comptime sum();
function main() {
  const t: T = -2;
  console.log(N, t, N[1] + 1);
  console.log(S, sum());
}
// case: const_assertion_object_rows
// expect: a 1
// expect: b 2
// Objects whose literals differ are a union of their object types, so their fields stay linked.
const ROWS = [{ k: "a", n: 1 }, { k: "b", n: 2 }] as const;
function main() {
  for (const r of ROWS) {
    if (r.k === "a") { const one: 1 = r.n; console.log(r.k, one); }
    else console.log(r.k, r.n);
  }
}
// case: const_assertion_rows_linked
// error: type '{ k: string; n: i64 }' is not assignable to type '{ readonly k: "a"; readonly n: 1 } | { readonly k: "b"; readonly n: 2 }'
const ROWS = [{ k: "a", n: 1 }, { k: "b", n: 2 }] as const;
type Row = typeof ROWS[number];
function main() {
  const r: Row = { k: "a", n: 2 };
  console.log(r.k);
}
// case: const_assertion_conditional_tuple
// expect: 1 x y
// expect: 11 null 0.0
// A tuple of literals beside a tuple it fits is that tuple, so the result destructures.
function literal(v: i64): [i64, string, string] { return [v, "x", "y"]; }
function pick(f: boolean) {
  const [kind, s, d] = f ? literal(1) : [11, "null", "0.0"] as const;
  console.log(kind, s, d);
}
function main() { pick(true); pick(false); }
// case: const_assertion_floats_enums
// expect: 2 1.5 1 2.5 -2.5 true 0
// Floats keep their number type, an enum member its own, and an empty array is an empty tuple.
enum Color { Red, Green }
const C = [Color.Red, Color.Green] as const;
const F = 1.5 as const;
const M = [1, 2.5] as const;
const FS = [1.5, -2.5] as const;
function main() {
  const r = Color.Red as const;
  const e = [] as const;
  console.log(C.length, F, M[0], M[1], FS[1], r === Color.Red, e.length);
}
// case: const_assertion_rest_index
// expect: x 3
// A position past a tuple's fixed elements is its rest element's type.
type R = [i64, ...string[]];
type B = R[1];
type A = R[number];
function main() { const b: B = "x"; const a: A = 3; console.log(b, a); }
