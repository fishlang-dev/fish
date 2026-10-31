// The Math functions and constants, number parsing, and toFixed. Math's functions are correctly
// rounded, so these are the same on every platform: the double nearest the exact result.
// case: math_float
// expect: 2.5 3 2 3 2 2.5 1
// expect: -2.5 -2 -3 -2 -2 2.5 -1
// expect: 0.5 1 0 1 0 0.5 1
// expect: 0.49999999999999994 0 0 1 0 0.49999999999999994 1
// expect: 1.5 2 1 2 1 1.5 1
// expect: -1.4 -1 -2 -1 -1 1.4 -1
// expect: 7 7 7 7 7 7 1
// expect: -3.7 -4 -4 -3 -3 3.7 -1
// expect: -Infinity -Infinity -Infinity Infinity -Infinity
// expect: 1.4142135623730951 3 1024 1.4142135623730951 2.718281828459045 1.00000000005e-10
// expect: 2.302585092994046 9.999999999500001e-11 3 3
// expect: 0.8414709848078965 0.5403023058681398 1.5574077246549023 0.5235987755982989 1.0471975511965979 0.7853981633974483 2.356194490192345
// expect: 1.1752011936438014 1.5430806348152437 0.7615941559557649 5
// expect: 3.141592653589793 2.718281828459045 0.6931471805599453 2.302585092994046 1.4426950408889634 0.4342944819032518 1.4142135623730951 0.7071067811865476
// expect: 7 -1 0 10 -7 200 7
// expect: 2 -1 3 0.25
// expect: -Infinity Infinity NaN NaN -Infinity NaN
// expect: NaN -Infinity -Infinity
function main() {
  const xs: f64[] = [2.5, -2.5, 0.5, 0.49999999999999994, 1.5, -1.4, 7, -3.7];
  for (const x of xs) console.log(x, Math.round(x), Math.floor(x), Math.ceil(x), Math.trunc(x), Math.abs(x), Math.sign(x));
  console.log(1 / Math.round(-0.5), 1 / Math.ceil(-0.5), 1 / Math.trunc(-0.0), 1 / Math.abs(-0.0), 1 / Math.floor(-0.0));
  console.log(Math.sqrt(2), Math.cbrt(27), Math.pow(2, 10), Math.pow(2, 0.5), Math.exp(1), Math.expm1(1e-10));
  console.log(Math.log(10), Math.log1p(1e-10), Math.log2(8), Math.log10(1000));
  console.log(Math.sin(1), Math.cos(1), Math.tan(1), Math.asin(0.5), Math.acos(0.5), Math.atan(1), Math.atan2(1, -1));
  console.log(Math.sinh(1), Math.cosh(1), Math.tanh(1), Math.hypot(3, 4));
  console.log(Math.PI, Math.E, Math.LN2, Math.LN10, Math.LOG2E, Math.LOG10E, Math.SQRT2, Math.SQRT1_2);
  const n = -7;
  const b: u8 = 200;
  const f = 1.5;
  console.log(Math.abs(n), Math.sign(n), Math.sign(0), Math.max(n, 3, 10, 2), Math.min(n, 3), Math.max(b, 100), Math.min(b, 7));
  console.log(Math.max(f, 2), Math.min(f, -1), Math.max(1, 2, 3), Math.min(0.5, 0.25));
  console.log(1 / Math.min(0, -0.0), 1 / Math.max(-0.0, 0), Math.max(1, 0.0 / 0.0), Math.min(0.0 / 0.0, 1), 1 / Math.sign(-0.0), Math.sign(0.0 / 0.0));
  console.log(Math.sqrt(-1), Math.log(0), 1 / Math.round(-0.4));
}
// case: math_release
// mode: release
// expect: 2.5 3 2 3 2 2.5 1
// expect: -2.5 -2 -3 -2 -2 2.5 -1
// expect: 0.5 1 0 1 0 0.5 1
// expect: 0.49999999999999994 0 0 1 0 0.49999999999999994 1
// expect: 1.5 2 1 2 1 1.5 1
// expect: -1.4 -1 -2 -1 -1 1.4 -1
// expect: 7 7 7 7 7 7 1
// expect: -3.7 -4 -4 -3 -3 3.7 -1
// expect: -Infinity -Infinity -Infinity Infinity -Infinity
// expect: 1.4142135623730951 3 1024 1.4142135623730951 2.718281828459045 1.00000000005e-10
// expect: 2.302585092994046 9.999999999500001e-11 3 3
// expect: 0.8414709848078965 0.5403023058681398 1.5574077246549023 0.5235987755982989 1.0471975511965979 0.7853981633974483 2.356194490192345
// expect: 1.1752011936438014 1.5430806348152437 0.7615941559557649 5
// expect: 3.141592653589793 2.718281828459045 0.6931471805599453 2.302585092994046 1.4426950408889634 0.4342944819032518 1.4142135623730951 0.7071067811865476
// expect: 7 -1 0 10 -7 200 7
// expect: 2 -1 3 0.25
// expect: -Infinity Infinity NaN NaN -Infinity NaN
// expect: NaN -Infinity -Infinity
function main() {
  const xs: f64[] = [2.5, -2.5, 0.5, 0.49999999999999994, 1.5, -1.4, 7, -3.7];
  for (const x of xs) console.log(x, Math.round(x), Math.floor(x), Math.ceil(x), Math.trunc(x), Math.abs(x), Math.sign(x));
  console.log(1 / Math.round(-0.5), 1 / Math.ceil(-0.5), 1 / Math.trunc(-0.0), 1 / Math.abs(-0.0), 1 / Math.floor(-0.0));
  console.log(Math.sqrt(2), Math.cbrt(27), Math.pow(2, 10), Math.pow(2, 0.5), Math.exp(1), Math.expm1(1e-10));
  console.log(Math.log(10), Math.log1p(1e-10), Math.log2(8), Math.log10(1000));
  console.log(Math.sin(1), Math.cos(1), Math.tan(1), Math.asin(0.5), Math.acos(0.5), Math.atan(1), Math.atan2(1, -1));
  console.log(Math.sinh(1), Math.cosh(1), Math.tanh(1), Math.hypot(3, 4));
  console.log(Math.PI, Math.E, Math.LN2, Math.LN10, Math.LOG2E, Math.LOG10E, Math.SQRT2, Math.SQRT1_2);
  const n = -7;
  const b: u8 = 200;
  const f = 1.5;
  console.log(Math.abs(n), Math.sign(n), Math.sign(0), Math.max(n, 3, 10, 2), Math.min(n, 3), Math.max(b, 100), Math.min(b, 7));
  console.log(Math.max(f, 2), Math.min(f, -1), Math.max(1, 2, 3), Math.min(0.5, 0.25));
  console.log(1 / Math.min(0, -0.0), 1 / Math.max(-0.0, 0), Math.max(1, 0.0 / 0.0), Math.min(0.0 / 0.0, 1), 1 / Math.sign(-0.0), Math.sign(0.0 / 0.0));
  console.log(Math.sqrt(-1), Math.log(0), 1 / Math.round(-0.4));
}
// case: math_correctly_rounded
// Inputs where glibc, macOS's libm or V8's fdlibm give a neighbour of the nearest double.
// expect: 1.3200061217959123 -0.7990214786596138 -0.2218487496163564 1.4596031111569496 0.18232155679395465
// expect: 0.201336002541094 1.0810723718384547 0.6043677771171635 0.09983407889920756 1.0469679150031885
function main() {
  console.log(Math.cbrt(2.3), Math.sin(29.2), Math.log10(0.6), Math.expm1(0.9), Math.log1p(0.2));
  console.log(Math.sinh(0.2), Math.cosh(0.4), Math.tanh(0.7), Math.asinh(0.1), Math.acosh(1.6));
}
// case: math_pow_js
// Where JavaScript's pow differs from C's: a NaN exponent, or a base of 1 or -1 to an infinite
// power, gives NaN, not 1. `**` is the same function.
// expect: NaN NaN NaN 1 1024 1.4142135623730951
// expect: NaN NaN 1.4142135623730951 2.755676
function main() {
  const nan = 0.0 / 0.0;
  const inf = 1 / 0.0;
  console.log(Math.pow(1, nan), Math.pow(1, inf), Math.pow(-1, -inf), Math.pow(nan, 0), Math.pow(2, 10), Math.pow(2, 0.5));
  const one = 1.0;
  const half = 0.5;
  const x: f32 = 1.5;
  const y: f32 = 2.5;
  console.log(one ** nan, (-one) ** inf, 2.0 ** half, x ** y);
}
// case: math_f32_and_shadowing
// expect: 2.5 1.5 -2.5 -1
// expect: 3
function main() {
  const x: f32 = 1.5;
  const y: f32 = -2.5;
  console.log(Math.abs(y), Math.max(x, y), Math.min(x, y, 0), Math.sign(y));
  const Math = 3;
  console.log(Math);
}
// case: math_class_named_math
// expect: 2
class Math { static floor(x: i64): i64 { return x + 1; } }
function main() {
  console.log(Math.floor(1));
}
// case: math_abs_overflow
// panic: attempt to negate with overflow
function main() {
  const n = -9223372036854775807 - 1;
  console.log(Math.abs(n));
}
// case: math_intarg
// error: 'Math.sqrt' takes a 'number', an f64, not 'i64'; convert it with 'as', as in 'n as f64'
function main() {
  const n = 4;
  console.log(Math.sqrt(n));
}
// case: math_mixed
// error: 'Math.max' takes numbers of one type, but got 'i64' and 'number'; convert one with 'as'
function main() {
  const n = 4;
  const f = 1.5;
  console.log(Math.max(n, f));
}
// case: math_random
// expect: true true true true
// Values are in [0, 1), spread evenly: the mean of 10000 is within 0.02 of 0.5, and a tenth of
// them land in each tenth of the range give or take a fifth.
function main() {
  let inRange = true;
  let sum = 0.0;
  let buckets: i64[] = new Array(10).fill(0);
  for (let i = 0; i < 10000; i++) {
    const x = Math.random();
    if (x < 0 || x >= 1) inRange = false;
    sum += x;
    buckets[Math.floor(x * 10) as i64 as usize] += 1;
  }
  const mean = sum / 10000;
  console.log(inRange, mean > 0.48 && mean < 0.52, buckets.every((b) => b > 800 && b < 1200), Math.random() !== Math.random());
}
// case: math_random_threads
// expect: true
// Tasks, which may run on other threads, draw values of their own.
async function draw(): Promise<f64> { return Math.random(); }
async function main() {
  const a = spawn(draw());
  const b = spawn(draw());
  const x = await a;
  const y = await b;
  console.log(x !== y);
}
// case: math_random_args
// error: 'Math.random' takes no arguments
function main() {
  console.log(Math.random(1));
}
// case: math_random_comptime
// error: 'Math.random' can't run while compiling; its value would be fixed into the program
function seed(): f64 { return Math.random(); }
function main() { console.log(comptime seed()); }
// case: math_unknown
// error: 'Math' has no 'clz32' in Fish yet
function main() {
  console.log(Math.clz32(1));
}
// case: math_strings
// error: 'Math.max' takes numbers, not '"a"'
function main() {
  console.log(Math.max("a", "b"));
}
// case: math_none
// error: 'Math.max' takes one or more numbers
function main() {
  console.log(Math.max());
}
// case: math_constant
// error: 'Math.TAU' is a function, or not in Fish yet; the constants are PI, E, LN2, LN10, LOG2E, LOG10E, SQRT2, SQRT1_2
function main() {
  console.log(Math.TAU);
}
// case: math_arity
// error: 'Math.pow' takes two numbers
function main() {
  console.log(Math.pow(2));
}
// case: parse_like_javascript
// expect: 0 42 66 NaN 146
// expect: 1 -17 -23 -1 -56661
// expect: 2 5 5 NaN 5
// expect: 3 31 31 0 42819
// expect: 4 31 31 0 42819
// expect: 5 NaN NaN NaN NaN
// expect: 6 NaN NaN NaN NaN
// expect: 7 NaN 2748 NaN 13368
// expect: 8 12 18 1 38
// expect: 9 1 483 1 1803
// expect: 10 0 0 0 0
// expect: 11 92233720368547758 NaN NaN NaN
// expect: 12 -92233720368547758 NaN NaN NaN
// expect: 13 7 7 NaN 7
// expect: 14 NaN NaN 0 33
// expect: 15 -16 -16 0 -42804
// expect: 16 8 8 0 8
// expect: 5 NaN NaN NaN 0
// expect: 0 3.14 3.14 3.14
// expect: 1 -2500 NaN -2500
// expect: 2 0.5 0.5 0.5
// expect: 3 5 5 5
// expect: 4 NaN NaN NaN
// expect: 5 -0.0005 -0.0005 -0.0005
// expect: 6 1 NaN 1
// expect: 7 1 NaN 1
// expect: 8 Infinity Infinity Infinity
// expect: 9 -Infinity NaN -Infinity
// expect: 10 Infinity Infinity Infinity
// expect: 11 NaN NaN NaN
// expect: 12 NaN NaN NaN
// expect: 13 0 16 0
// expect: 14 1 NaN 1
// expect: 15 NaN 0 NaN
// expect: 16 12 12 12
// expect: 17 8 8 8
// expect: 18 Infinity Infinity Infinity
// expect: 19 0 0 0
// expect: 20 0.1 0.1 0.1
// expect: 21 1.2345678901234568e+29 1.2345678901234568e+29 1.2345678901234568e+29
// expect: 22 5e-324 5e-324 5e-324
// expect: 23 NaN 0 NaN
// expect: 24 0 5 0
// expect: 25 0 15 0
// expect: 26 0 31 0
// expect: 27 0 NaN 0
// expect: 28 1 NaN 1
// expect: 29 3 3 3
// expect: 77 91
function show(x: i64 | null): string {
  return x === null ? "NaN" : "" + x;
}
function showF(x: f64 | null): string {
  return x === null ? "NaN" : "" + x;
}
function main() {
  const ints = ["42", "  -17px", "+5", "0x1F", "0X1f", "", "  ", "abc", "12.9", "1e3", "-0", "92233720368547758", "-92233720368547758", " \t\n 7", "0x", "-0x10", "08"];
  for (const [i, s] of ints.entries()) console.log(i, show(parseInt(s)), show(parseInt(s, 16)), show(parseInt(s, 2)), show(Number.parseInt(s, 36)));
  console.log(show(parseInt("12", 3)), show(parseInt("z", 37)), show(parseInt("1", 1)), show(parseInt("ff", 0)), show(parseInt("0x1f", 10)));
  const floats = ["3.14", "  -2.5e3xyz", ".5", "5.", ".", "-.5e-3", "1e", "1e+", "+Infinity", "-Infinityx", "Infinity", "infinity", "NaN", "0x10", "1_000", "", "  12  ", "  8", "1e1000", "-0", "0.1", "123456789012345678901234567890", "4.9e-324", "  \n", "0b101", "0o17", "  0x1F  ", "+0x1", "1 2", "﻿3"];
  for (const [i, s] of floats.entries()) console.log(i, showF(parseFloat(s)), showF(Number(s)), showF(Number.parseFloat(s)));
  const r: Ref<string> = "77";
  console.log(show(parseInt(r)), showF(Number("9" + 1)));
}
// case: parse_int_range
// expect: 9223372036854775807 null
// expect: null null
// expect: -9223372036854775808 null
// expect: null null
// expect: 7 9223372036854775807
// expect: 8000000000000000 null
// expect: 43
// expect: 5
function main() {
  const edges = ["9223372036854775807", "9223372036854775808", "-9223372036854775808", "-9223372036854775809", "7fffffffffffffff", "8000000000000000"];
  for (const s of edges) {
    const a = parseInt(s);
    const b = parseInt(s, 16);
    console.log(a === null ? "null" : "" + a, b === null ? "null" : "" + b);
  }
  const n = parseInt("42");
  if (n !== null) console.log(n + 1);
  const f = parseFloat("2.5") ?? 0.0;
  console.log(f * 2);
}
// case: parse_shadowed
// expect: 7
function parseInt(s: string): i64 { return 7; }
function main() {
  console.log(parseInt("1"));
}
// case: parse_number_int
// error: 'Number' parses a string, not 'i64'; to convert a number, write 'x as f64'
function main() {
  const n = 5;
  console.log(Number(n));
}
// case: parse_bool
// error: 'parseInt' parses a string, not 'boolean'
function main() {
  console.log(parseInt(true));
}
// case: parse_arity
// error: 'parseFloat' takes one string
function main() {
  console.log(parseFloat("1", 2));
}
// case: parse_radix
// error: a radix is an 'i64', not 'number'
function main() {
  const r = 2.5;
  console.log(parseInt("1", r));
}
// case: to_fixed
// expect: 3 2.5 2.50 2.50000 2.50000000000000000000
// expect: 1 1.0 1.00 1.00500 1.00499999999999989342
// expect: 1 1.4 1.45 1.45000 1.44999999999999995559
// expect: -2 -1.5 -1.50 -1.50000 -1.50000000000000000000
// expect: -0 -0.0 -0.00 -0.00010 -0.00010000000000000000
// expect: 0 0.0 0.00 0.00000 0.00000000000000000000
// expect: 0 0.0 0.00 0.00000 0.00000000000000000000
// expect: 1e+21 1e+21 1e+21 1e+21 1e+21
// expect: 1.2e+21 1.2e+21 1.2e+21 1.2e+21 1.2e+21
// expect: 123 123.5 123.46 123.45600 123.45600000000000306954
// expect: 0 0.0 0.00 0.00000 0.00000100000000000000
// expect: 0 0.0 0.00 0.00000 0.00000010000000000000
// expect: NaN NaN NaN NaN NaN
// expect: Infinity Infinity Infinity Infinity Infinity
// expect: -Infinity -Infinity -Infinity -Infinity -Infinity
// expect: 8 8.3 8.35 8.34500 8.34500000000000063949
// expect: 10 10.2 10.23 10.23500 10.23499999999999943157
// expect: 100 100.0 100.00 99.99500 99.99500000000000454747
// expect: 1 0.5 0.50 0.50000 0.50000000000000000000
// expect: -1 -0.5 -0.50 -0.50000 -0.50000000000000000000
// expect: 1 1.3 1.25 1.25000 1.25000000000000000000
// expect: 1 1.4 1.35 1.35000 1.35000000000000008882
// expect: 0 0.0 0.00 0.00000 0.00000000000000000000
// expect: 123456789012345683968 123456789012345683968.0 123456789012345683968.00 123456789012345683968.00000 123456789012345683968.00000000000000000000
// expect: 5.00 -7 102
// expect: 255.0 9007199254740993 0.1000000015 -9223372036854775808.00
function main() {
  const xs: f64[] = [2.5, 1.005, 1.45, -1.5, -0.0001, -0.0, 0, 1e21, 1.2e21, 123.456, 0.000001, 1e-7, 0.0 / 0.0, 1.0 / 0.0, -1.0 / 0.0, 8.345, 10.235, 99.995, 0.5, -0.5, 1.25, 1.35, 5e-324, 123456789012345680000];
  for (const x of xs) console.log(x.toFixed(0), x.toFixed(1), x.toFixed(2), x.toFixed(5), x.toFixed(20));
  console.log((5).toFixed(2), (-7).toFixed(0), (0.1).toFixed(100).length);
  const b: u8 = 255;
  const big = 9007199254740993;
  const h: f32 = 0.1;
  console.log(b.toFixed(1), big.toFixed(0), h.toFixed(10), (-9223372036854775807 - 1).toFixed(2));
}
// case: to_fixed_default_and_statement
// expect: 2 2 -3
function main() {
  console.log((1.5).toFixed(), (2).toFixed(), (-2.5).toFixed());
  const x = 2.5;
  x.toFixed(1);
  console.log("v" + x.toFixed(1));
}
// expect: v2.5
// case: to_fixed_range
// panic: toFixed() digits argument must be between 0 and 100
function main() {
  const d = 101;
  console.log((1.5).toFixed(d));
}
// case: to_fixed_negative
// panic: toFixed() digits argument must be between 0 and 100
function main() {
  console.log((1.5).toFixed(-1));
}
// case: to_fixed_float_digits
// error: 'toFixed' takes its digits as an 'i64', not 'number'
function main() {
  console.log((1.5).toFixed(1.5));
}
// case: parse_lone_sign
// expect: true true
function main(): void {
  const a = Number("-");
  const b = Number(" + ");
  console.log(a === null, b === null);
}
// case: math_hidden_by_top_level_const
// expect: 3 1
const Math = { PI: 3.0, E: 1.0 };
function main(): void { console.log(Math.PI, Math.E); }
// case: math_optional_call
// error: 'Math' is always there, so its functions are called without '?.'
function main(): void {
  const x = Math?.sqrt(4.0);
  console.log(x);
}
// case: parse_prefix_rounding
// expect: true
// expect: 144115188075855900
function main(): void {
  const a = Number("0b1" + "0".repeat(52) + "11");
  if (a !== null) console.log(a === 18014398509481988.0);
  const b = Number("0x200000000000011");
  if (b !== null) console.log(b);
}
// case: to_fixed_through_ref
// expect: 1.25
function f(r: Ref<f64>): string { return r.toFixed(2); }
function main(): void { console.log(f(1.25)); }
// case: math_through_ref
// expect: 6
function f(r: Ref<f64>): f64 { return Math.sqrt(r) + r; }
function main(): void { console.log(f(4.0)); }
// case: math_enum_named_math
// expect: 1
enum Math { A = 1 }
function main(): void { console.log(Math.A); }
