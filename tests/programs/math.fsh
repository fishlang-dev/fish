// The Math functions and constants, number parsing, and toFixed.
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
// expect: 0.8414709848078965 0.5403023058681398 1.557407724654902 0.5235987755982988 1.0471975511965976 0.7853981633974483 2.356194490192345
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
// expect: 0.8414709848078965 0.5403023058681398 1.557407724654902 0.5235987755982988 1.0471975511965976 0.7853981633974483 2.356194490192345
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
// error: 'Math.random' is not supported yet; it will come from the OS's secure random source
function main() {
  console.log(Math.random());
}
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
