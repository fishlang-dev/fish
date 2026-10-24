// Several declarators in one statement, and variables declared and assigned later.
// case: declarators
// expect: 1 2 x1 20 7 1 q2 x1 n 2 6
// expect: 0 10
// expect: 3 10
// expect: 6 10
// expect: 9 10
// expect: 0 0 t1 0
// expect: 1 0 t1 0
// expect: x 0
// expect: x 1
// expect: 5 3
const K = 2, L = K * 3;
function main() {
  let a = 1, b = a + 1, s = "x" + a;
  const c = b * 10, d: u8 = 7;
  const { p, q } = { p: 1, q: "q" + 2 }, [m, n] = [s, "n"];
  console.log(a, b, s, c, d, p, q, m, n, K, L);
  for (let i = 0, j = 10; i < j; i += 3) console.log(i, j);
  outer: for (let i = 0, t = "t" + 1; i < 3; i++) {
    for (let k = 0, z = 0; k < 3; k++) {
      if (k === 1) continue outer;
      if (i === 2) break outer;
      console.log(i, k, t, z);
    }
  }
  if (a === 1) for (let x = 0, y = 2; x < y; x++) console.log("x", x);
  a = 5; b++;
  console.log(a, b);
}
// case: declarators_const_value
// error: a 'const' needs its value where it is declared
function main() {
  const a = 1, b: i64;
  console.log(a);
}
// case: deferred
// expect: pos1 neg-2
// expect: 0 t0
// expect: 2 t1
// expect: 4 t2
// expect: four
// expect: c1
// expect: 4
// expect: b2
// expect: w1
class Big { constructor() {} }
class C { constructor(public s: string) {} }
function make(n: i64): C throws Big {
  if (n > 1) throw new Big();
  return new C("c" + n);
}
function pick(n: i64): string {
  let s: string;
  if (n > 0) s = "pos" + n;
  else s = "neg" + n;
  return s;
}
function main() {
  console.log(pick(1), pick(-2));
  let n: i64;
  let t: string;
  for (let i = 0; i < 3; i++) {
    n = i * 2;
    t = "t" + i;
    console.log(n, t);
  }
  let k: string;
  switch (pick(1).length) {
    case 4: k = "four"; break;
    default: k = "other";
  }
  console.log(k);
  let c: C;
  try {
    c = make(1);
  } catch (e) {
    c = new C("none");
  }
  console.log(c.s);
  let unused: string;
  let some: string;
  if (k === "four") some = "set" + 1;
  let x: i64;
  x = 1;
  x += 2;
  x++;
  console.log(x);
  let r: string;
  r = "a" + 1;
  r = "b" + 2;
  console.log(r);
  let w: string;
  while (true) {
    w = "w" + 1;
    break;
  }
  console.log(w);
}
// case: deferred_async_and_panic
// panic: attempt to divide by zero
// expect: o1 2 s1 pos3
// expect: g1
type P = { a: i64; s: string };
function boom(n: i64): i64 {
  if (n > 0) return n / (n - n);
  return n;
}
async function later(n: i64): Promise<string> {
  let s: string;
  await sleep(1);
  if (n > 0) s = "pos" + n;
  else s = "neg";
  await sleep(1);
  return s;
}
function* gen(): Generator<string> {
  let s: string;
  s = "g" + 1;
  yield s;
}
async function main() {
  let o: string | null;
  let p: P;
  o = "o" + 1;
  p = { a: 1, s: "s" + 1 };
  p.a = 2;
  const l = await later(3);
  console.log(o, p.a, p.s, l);
  for (const g of gen()) console.log(g);
  let m: Map<string, i64>;
  let e: string | null;
  let q: P;
  boom(1);
  m = new Map();
  console.log(m.size);
}
// case: deferred_read
// error: 's' is used before being assigned; give it a value on every path that reaches here, as TypeScript requires
function main() {
  let s: string;
  console.log(s);
}
// case: deferred_onepath
// error: 's' is used before being assigned; give it a value on every path that reaches here, as TypeScript requires
function main() {
  let s: string;
  if (1 > 0) s = "a" + 1;
  console.log(s);
}
// case: deferred_loop
// error: 'n' is used before being assigned; give it a value on every path that reaches here, as TypeScript requires
function main() {
  let n: i64;
  for (let i = 0; i < 2; i++) n = i;
  console.log(n);
}
// case: deferred_loopread
// error: 's' is used before being assigned; give it a value on every path that reaches here, as TypeScript requires
function main() {
  let s: string;
  while (true) {
    console.log(s);
    s = "x";
  }
}
// case: deferred_capture
// error: 's' is used before being assigned; give it a value on every path that reaches here, as TypeScript requires
function main() {
  let s: string;
  const f = () => s.length;
  s = "a";
  console.log(f());
}
// case: deferred_move
// error: 's' is used before being assigned; give it a value on every path that reaches here, as TypeScript requires
function main() {
  let s: string;
  const t = s;
  s = "b";
}
// case: deferred_incr
// error: 'n' is used before being assigned; give it a value on every path that reaches here, as TypeScript requires
function main() {
  let n: i64;
  n++;
}
// case: deferred_field
// error: 'p' is used before being assigned, so 'p.a' can't be set; assign all of 'p' first
type P = { a: i64 };
function main() {
  let p: P;
  p.a = 1;
}
// case: deferred_notype
// error: 'x' needs a type to be declared without a value, like 'let x: string'; Fish doesn't work it out from later assignments
function main() {
  let x;
  x = 1;
}
// case: deferred_destructuring
// error: a destructuring declaration needs its value where it is declared
function main() {
  let { a }: { a: i64 };
}
// case: deferred_interface
// error: 'n' needs its value where it is declared, since an interface describes
interface Named { name(): string }
function main() {
  let n: Named;
}
