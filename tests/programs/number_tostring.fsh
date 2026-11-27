// case: number_tostring_integers
// expect: 255 ff -11111111 z
// expect: 11001000 -80000000 ffffffffffffffff 18446744073709551615
// expect: -7ksyyizzkutudzbv8aqztecjk
// expect: 377 255
// toString on sized integers, with no radix and with one, in every width.
function main() {
  const a: i64 = 255;
  const b: i64 = -255;
  const c: u8 = 200;
  const d: i32 = -2147483648;
  const u: u64 = 18446744073709551615;
  const w: i128 = -170141183460469231731687303715884105727 - 1;
  console.log(a.toString(), a.toString(16), b.toString(2), (35).toString(36));
  console.log(c.toString(2), d.toString(16), u.toString(16), u.toString());
  console.log(w.toString(36));
  let r: i64 = 8;
  console.log(a.toString(r), a.toString(10));
}
// case: number_tostring_floats
// expect: 3.5 0.0001100110011001100110011001100110011001100110011001101 -3.c 1e+21 5v1j4f4ds7c000
// expect: 0.1111111111111111111111111111111112 3f.gez4w97ry NaN Infinity -Infinity 0
// expect: 1e-7 1e-7 100000000000000000000000000000000000000000000000000010
// expect: 0.1 0.000110011001100110011001101 0.1
// toString on floats prints as JavaScript's Number.prototype.toString does, an f32 by its own
// shortest digits in base 10.
function main() {
  const nan: f64 = 0.0 / 0.0;
  const inf: f64 = 1.0 / 0.0;
  const zero: f64 = -0.0;
  const big: f64 = 9007199254740994.0;
  const q: f32 = 0.1;
  console.log((3.5).toString(), (0.1).toString(2), (-3.75).toString(16), (1e21).toString(), (1e21).toString(36));
  console.log((0.5).toString(3), (123.456).toString(36), nan.toString(2), inf.toString(16), (-inf).toString(36), zero.toString(2));
  console.log((1e-7).toString(), (1e-7).toString(10), big.toString(2));
  console.log(q.toString(), q.toString(2), q.toString(10));
}
// case: number_tostring_statement
// expect: done
// A toString whose text nobody reads is dropped.
function main() {
  const n: i64 = 42;
  n.toString(16);
  n.toString();
  console.log("done");
}
// case: number_tostring_radix_low
// panic: toString() radix argument must be between 2 and 36
function main() {
  let r: i64 = 1;
  console.log((10).toString(r));
}
// case: number_tostring_radix_high
// panic: toString() radix argument must be between 2 and 36
function main() {
  const x: f64 = 1.5;
  console.log(x.toString(37));
}
// case: number_tostring_arguments
// error: 'toString' takes at most a radix
function main() { const n: i64 = 1; console.log(n.toString(2, 3)); }
