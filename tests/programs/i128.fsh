// case: i128_arithmetic
function main(): void {
  const c: i128 = 9223372036854775807;
  const d = c * 4 + 3;
  const e = (d as u128) << 10;
  const f: i128 = -d / 7;
  console.log(d, e, f, d % 1000, (d / 1000000) ** 2);
  const one: i128 = 1;
  console.log(one << 127, (one << 127) >> 127, (one << 127) as u128 >>> 120, ~one, d & 255, d | 1, d ^ d);
  let n: u128 = 18446744073709551615;
  n++;
  n *= n - 1;
  console.log(n, n as u64, n as i8, n as f64, -7 as i128 as u128, 1.5e30 as u128);
}
// expect: 36893488147419103231 37778931862957161708544 -5270498306774157604 231 1361129467683746236676361561
// expect: -170141183460469231731687303715884105728 -1 128 -2 255 36893488147419103231 0
// expect: 340282366920938463444927863358058659840 0 0 3.402823669209385e+38 340282366920938463463374607431768211449 1499999999999999889089448902656
// case: i128_printing
type W = { n: u128; m: i128 };
function main(): void throws JsonError {
  const a: i128 = -170141183460469231731687303715884105727 - 1;
  const b: u128 = 340282366920938463463374607431768211455;
  console.log(a, b);
  console.log(`${a} ${b}`, String(b));
  const w: W = { n: b, m: a };
  console.log(w, [a], JSON.stringify(w));
  const back = JSON.parse<W>(JSON.stringify(w));
  console.log(back.n === b, back.m === a);
  const maybe: i128 | null = a;
  const either: u128 | string = b;
  console.log(maybe, either);
}
// expect: -170141183460469231731687303715884105728 340282366920938463463374607431768211455
// expect: -170141183460469231731687303715884105728 340282366920938463463374607431768211455 340282366920938463463374607431768211455
// expect: {
// expect:   m: -170141183460469231731687303715884105728,
// expect:   n: 340282366920938463463374607431768211455
// expect: } [ -170141183460469231731687303715884105728 ] {"m":-170141183460469231731687303715884105728,"n":340282366920938463463374607431768211455}
// expect: true true
// expect: -170141183460469231731687303715884105728 340282366920938463463374607431768211455
// case: i128_json_range
type W = { n: u128 };
function main(): void {
  try {
    console.log(JSON.parse<W>(`{"n":340282366920938463463374607431768211455}`).n);
    JSON.parse<W>(`{"n":340282366920938463463374607431768211456}`);
  } catch (e) {
    console.log(e.message);
  }
}
// expect: 340282366920938463463374607431768211455
// expect: 340282366920938463463374607431768211456 doesn't fit u128 at $.n
// case: i128_comptime
function big(k: u128): u128 {
  const x: u128 = 18446744073709551616;
  return x * k;
}
const P: u128 = comptime big(1000);
function main(): void {
  console.log(P, P === big(1000));
}
// expect: 18446744073709551616000 true
// case: i128_add_overflow
function main(): void {
  const top: i128 = 170141183460469231731687303715884105727;
  const one: i128 = 1;
  console.log(top + one);
}
// panic: attempt to add with overflow
// case: i128_mul_overflow
function main(): void {
  const top: u128 = 340282366920938463463374607431768211455;
  const two: u128 = 2;
  console.log(top * two);
}
// panic: attempt to multiply with overflow
// case: i128_divide_overflow
function main(): void {
  const low: i128 = -170141183460469231731687303715884105727 - 1;
  const minus: i128 = -1;
  console.log(low / minus);
}
// panic: attempt to divide with overflow
// case: i128_divide_by_zero
function main(): void {
  const zero: u128 = 0;
  const one: u128 = 1;
  console.log(one / zero);
}
// panic: attempt to divide by zero
// case: i128_wrap
// mode: release
function main(): void {
  const top: i128 = 170141183460469231731687303715884105727;
  const one: i128 = 1;
  console.log(top + one);
}
// expect: -170141183460469231731687303715884105728
// case: i128_literal_range
function main(): void {
  const n: u128 = 340282366920938463463374607431768211456;
}
// error: '340282366920938463463374607431768211456' doesn't fit in 'u128'
// case: i128_map_key
function main(): void {
  const m = new Map<i128, string>();
}
// error: a 'Map' is keyed by strings or integers, or unions of their literals, not 'i128'
// case: i128_atomic
function main(): void {
  const a = new Atomic<u128>(0);
}
// error: 'Atomic' holds integers of up to 64 bits, not 'u128'
// case: i128_to_fixed
function main(): void {
  const x: i128 = 5;
  console.log(x.toFixed(1));
}
// error: 'toFixed' on a 128-bit integer isn't supported yet; convert it with 'as f64' first
