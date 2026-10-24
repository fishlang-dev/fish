// case: literal_mismatch
function main() {
  const d: "up" = "down"
}
// error: type '"down"' is not assignable to type '"up"'
// case: literal_mut_alias
// error: 's' is borrowed mutably twice in one value, which would let one change what the other reads
function main() { let s = "a" + 1; let o: { a: Mut<string>; b: Mut<string> } = { a: s, b: s }; o.a = "x"; console.log(o.b); }
// case: literal_mut_alias_nested
// error: 'xs[0]' is borrowed mutably and shared in one value, which would let one change what the other reads
function main() {
  let xs: string[] = ["a" + 1];
  let o: { a: { m: Mut<string[]> }; b: Ref<string> } = { a: { m: xs }, b: xs[0] };
  let i = 0;
  while (i < 100) { o.a.m.push("p" + i); i += 1; }
  o.a.m[0] = "gone" + 1;
  console.log(o.b);
}
// case: literal_no_overlap
function main() {
  const d = "up"
  print(d === "down")
}
// error: this comparison appears to be unintentional because the types '"up"' and '"down"' have no overlap
// case: literal_number_mismatch
function main() {
  const x = 2
  const n: 1 = x
}
// error: type 'i64' is not assignable to type '1'
// case: literal_refs_ok
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
// case: literal_types
type Up = "up"

function direction(d: Up): Up {
  return d
}

function one(): 1 {
  return 1
}

function main() {
  const d: Up = "up"
  const n: 1 = 1
  const no: false = false
  const m: -5 = -5
  print(d, n, no, m, direction("up"))
  // A literal reads as its base type.
  const sum = n + one() + m
  print(sum, !no, n === 1)
  let total: i64 = n
  total += m
  print(total)
  const s = "literal"
  print(s === "literal")
}
// expect: up 1 false -5 up
// expect: -3 true true
// expect: -4
// expect: true
