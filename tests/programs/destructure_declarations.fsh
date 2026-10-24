// expect: 1 ann1 none 5 2 bee
// expect: s1 3
// expect: x y missing 0
// expect: 10
// expect: 1 w2 3
// Object and array patterns in declarations: renames, defaults for null fields, nesting, rest,
// holes, tuples, arrays of copies with defaults and rest, and let names that change.
class P { n: i64; constructor(n: i64) { this.n = n; } }
type User = { id: i64; name: string; tag: string | null; pet: P; extra: { a: i64; b: string } };
function main() {
  const u: User = { id: 1, name: "ann" + 1, tag: null, pet: new P(5), extra: { a: 2, b: "bee" } };
  const { id, name: label, tag = "none", pet, extra: { a, b }, ...rest } = u;
  console.log(id, label, tag, pet.n, a, b);
  const t: [string, i64, P] = ["s" + 1, 2, new P(3)];
  const [first, , third] = t;
  console.log(first, third.n);
  const parts = "x,y,z".split(",");
  const [p0, p1 = "d", , p3 = "missing", ...others] = parts;
  console.log(p0, p1, p3, others.length);
  let { n } = new P(9);
  n = n + 1;
  console.log(n);
  const v = { q: 1, r: "w" + 2, s: 3 };
  const { q, ...left } = v;
  console.log(q, left.r, left.s);
}
