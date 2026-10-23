// expect: 1 true 200 5 5 true
// expect: 1 true false
// A hole of never spells nothing, so a key renamed through one is dropped; boolean holes
// spell true and false; infer takes other integer types and union bounds; a homomorphic mapped
// type over a field holding its own null gives the null '?' added when the new type has none.
type U = { a: i64; b: i64 };
type G<T> = { [K in keyof T as `get${K extends "a" ? never : K}`]: T[K] };
type B = `${boolean}`;
type U8<S> = S extends `${infer N extends u8}` ? N : "no";
type I32<S> = S extends `${infer N extends i32}` ? N : "no";
type Either<S> = S extends `${infer N extends i64 | boolean}` ? N : "no";
type Held = { a?: string | null };
type Arr<X> = { [K in keyof X]: X[K][] };
type Px = `${number}px`;
function wide(o: Px | string): string { return o; }
function main() {
  const g: G<U> = { getb: 1 };
  const b: B = "true";
  const u: U8<"200"> = 200;
  const i: I32<"5"> = 5;
  const n: Either<"5"> = 5;
  const t: Either<"true"> = true;
  console.log(g.getb, b, u, i, n, t);
  const q: Required<Arr<Held>> = { a: [null] };
  console.log(q.a.length, wide("3px") === "3px", "1." === wide("x"));
}
