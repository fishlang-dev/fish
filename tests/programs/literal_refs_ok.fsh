// expect: s1 s1 s1 s1
// expect: y1
// expect: x2 y2
// Shared borrows of one place, and borrows of different fields, may sit in one value.
type P = { x: string; y: string };
function main() {
  const s = "s" + 1;
  const t: [Ref<string>, Ref<string>] = [s, s];
  let o: { a: Ref<string>; b: Ref<string> } = { a: s, b: s };
  console.log(t[0], t[1], o.a, o.b);
  let p: P = { x: "x" + 1, y: "y" + 1 };
  let m: { a: Mut<string>; b: Ref<string> } = { a: p.x, b: p.y };
  m.a = "z" + 1;
  console.log(m.b);
  let q: P = { x: "x" + 2, y: "y" + 2 };
  let n: [Mut<string>, Mut<string>] = [q.x, q.y];
  console.log(n[0], n[1]);
}
