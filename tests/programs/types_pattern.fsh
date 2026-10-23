// expect: 12px 4 12PX true
// expect: x y-z 42 7 id-9 a
// Pattern types: a string literal fits a template with open holes when it matches, and a
// value of one is a string. Conditional types take string literals apart with 'infer'.
type Px = `${number}px`;
type Id = `id-${i64}`;
type Head<S> = S extends `${infer A}-${infer B}` ? A : never;
type Tail<S> = S extends `${infer A}-${infer B}` ? B : never;
type Num<S> = S extends `n${infer N extends i64}` ? N : never;
type Ev = `on${string}`;
function size(p: Px): string { return p; }
function main() {
  const p: Px = "12px";
  const big = p.toUpperCase();
  const e: Ev = "onclick";
  console.log(size(p), p.length, big, p === "12px");
  const h: Head<"x-y-z"> = "x";
  const t: Tail<"x-y-z"> = "y-z";
  const n: Num<"n42"> = 42;
  const id: Id = "id-9";
  const mixed: `${"a" | "b"}${string}` = "a";
  console.log(h, t, n, e.length - 0, id, mixed);
}
