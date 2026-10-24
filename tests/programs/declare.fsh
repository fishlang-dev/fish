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
