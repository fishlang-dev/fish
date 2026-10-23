// expect: xy-1 z3
// A generic class over an object type mixing optional and required fields, in both spellings.
class Box<T> { v: T; constructor(v: T) { this.v = v; } }
type P = { k?: i64; s: string };
function show(b: Ref<Box<P>>): string { return b.v.s + String(b.v.k ?? -1); }
function main() {
  const a: P = { s: "x" + "y" };
  const b = new Box(a);
  const c: Box<{ k: i64 | null; s: string }> = new Box<{ k: i64 | null; s: string }>({ k: 3, s: "z" });
  console.log(show(b), show(c));
}
