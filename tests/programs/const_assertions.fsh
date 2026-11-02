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
// error: a 'const' assertion can only be applied to a string, number, boolean, array or object literal
function main() {
  const x = 1;
  const y = x as const;
  console.log(y);
}
