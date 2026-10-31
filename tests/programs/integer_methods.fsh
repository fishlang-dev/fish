// Rust's checked, wrapping, saturating and overflowing methods on every sized integer, the same
// in every build and in comptime.
// case: integer_methods_add_sub_mul_neg
// expect: null -128 127 [ -128, true ]
// expect: null 127 -128 [ 127, true ]
// expect: 0 null [ 0, false ] -1
// expect: null -128 127 -128 -128 [ -2, true ]
// expect: null -128 127 -127 0
// expect: null 0 255 null 255 0
// expect: null 254 255 [ 254, true ] [ 255, true ]
// expect: 0 null 1
// expect: null -9223372036854775808 9223372036854775807 -9223372036854775808
// expect: null 1 18446744073709551615
// expect: -32768 4294967295 null [ 0, true ] -2147483648 null
function main() {
  const max: i8 = 127;
  const min: i8 = -128;
  const minusOne: i8 = -1;
  const zero: i8 = 0;
  console.log(max.checkedAdd(1), max.wrappingAdd(1), max.saturatingAdd(1), max.overflowingAdd(1));
  console.log(min.checkedSub(1), min.wrappingSub(1), min.saturatingSub(1), min.overflowingSub(1));
  console.log(minusOne.checkedAdd(1), min.checkedAdd(minusOne), minusOne.overflowingAdd(1), zero.checkedSub(1));
  console.log(min.checkedMul(-1), min.wrappingMul(-1), min.saturatingMul(-1), min.saturatingMul(2), max.saturatingMul(-2), max.overflowingMul(2));
  console.log(min.checkedNeg(), min.wrappingNeg(), min.saturatingNeg(), max.checkedNeg(), zero.wrappingNeg());
  const umax: u8 = 255;
  const uzero: u8 = 0;
  console.log(umax.checkedAdd(1), umax.wrappingAdd(1), umax.saturatingAdd(1), uzero.checkedSub(1), uzero.wrappingSub(1), uzero.saturatingSub(1));
  console.log(umax.checkedMul(2), umax.wrappingMul(2), umax.saturatingMul(2), umax.overflowingMul(2), uzero.overflowingSub(1));
  console.log(uzero.checkedNeg(), umax.checkedNeg(), umax.wrappingNeg());
  const big = 9223372036854775807;
  console.log(big.checkedAdd(1), big.wrappingAdd(1), big.saturatingAdd(1), (-big - 1).saturatingSub(1));
  const ubig: u64 = 18446744073709551615;
  console.log(ubig.checkedAdd(1), ubig.wrappingAdd(2), ubig.saturatingMul(3));
  const a: i16 = 32767;
  const b: u32 = 4294967295;
  const c: usize = 0;
  const d: u16 = 65535;
  const e: i32 = -2147483648;
  const f: isize = 9223372036854775807;
  console.log(a.wrappingAdd(1), b.saturatingAdd(5), c.checkedSub(1), d.overflowingAdd(1), e.wrappingNeg(), f.checkedMul(2));
}
// case: integer_methods_release
// mode: release
// expect: null -128 127 [ -128, true ] null 0
// The methods mean the same in a release build, where `+` wraps.
function main() {
  const max: i8 = 127;
  const min: i8 = -128;
  console.log(max.checkedAdd(1), max.wrappingAdd(1), max.saturatingAdd(1), max.overflowingAdd(1), min.checkedNeg(), min.wrappingRem(-1));
}
// case: integer_methods_div_rem
// expect: null -128 127 null -127 -64
// expect: null 0 null -2 7
// expect: null 66 28 null 4
// expect: null -9223372036854775808 9223372036854775807 0
function main() {
  const min: i8 = -128;
  const max: i8 = 127;
  console.log(min.checkedDiv(-1), min.wrappingDiv(-1), min.saturatingDiv(-1), min.checkedDiv(0), max.checkedDiv(-1), min.checkedDiv(2));
  console.log(min.checkedRem(-1), min.wrappingRem(-1), max.checkedRem(0), min.checkedRem(3), max.wrappingRem(-10));
  const u: u8 = 200;
  console.log(u.checkedDiv(0), u.wrappingDiv(3), u.saturatingDiv(7), u.checkedRem(0), u.wrappingRem(7));
  const low = -9223372036854775807 - 1;
  console.log(low.checkedDiv(-1), low.wrappingDiv(-1), low.saturatingDiv(-1), low.wrappingRem(-1));
}
// case: integer_methods_shift_pow
// expect: 0 null -16 -32 -4 -4 null
// expect: 15 15 224 null
// expect: -9223372036854775808 null 2 null
// expect: 64 null -128 127 -128 -128 127 0
// expect: 1 1 -1 243 null 217 255
// expect: 1000000000000000000 null 9223372036854775807 -8446744073709551616 null
function main() {
  const s: i8 = -16;
  console.log(s.checkedShl(7), s.checkedShl(8), s.wrappingShl(8), s.wrappingShl(9), s.checkedShr(2), s.wrappingShr(10), s.checkedShr(8));
  const us: u8 = 240;
  console.log(us.checkedShr(4), us.wrappingShr(12), us.wrappingShl(1), us.checkedShl(100));
  const one = 1;
  console.log(one.checkedShl(63), one.checkedShl(64), one.wrappingShl(65), one.checkedShr(4294967295));
  const two: i8 = 2;
  const minusTwo: i8 = -2;
  console.log(two.checkedPow(6), two.checkedPow(7), two.wrappingPow(7), two.saturatingPow(7), minusTwo.checkedPow(7), minusTwo.saturatingPow(9), minusTwo.saturatingPow(8), minusTwo.wrappingPow(8));
  const zero: i8 = 0;
  const minusOne: i8 = -1;
  const three: u8 = 3;
  console.log(zero.checkedPow(0), zero.wrappingPow(0) + 0, minusOne.checkedPow(3), three.checkedPow(5), three.checkedPow(6), three.wrappingPow(6), three.saturatingPow(6));
  const ten = 10;
  const tenU: u64 = 10;
  console.log(ten.checkedPow(18), ten.checkedPow(19), ten.saturatingPow(19), ten.wrappingPow(19), tenU.checkedPow(20));
}
// case: integer_methods_divide_by_zero
// panic: attempt to divide by zero
// Wrapping division still panics on a zero divisor, as Rust's does.
function main() {
  const x: u8 = 1;
  const zero: u8 = 0;
  console.log(x.wrappingDiv(zero));
}
// case: integer_methods_remainder_by_zero
// panic: attempt to calculate the remainder with a divisor of zero
function main() {
  const x: i32 = 1;
  console.log(x.wrappingRem(0));
}
// case: integer_methods_saturating_div_by_zero
// panic: attempt to divide by zero
function main() {
  const x = -9223372036854775807 - 1;
  console.log(x.saturatingDiv(0));
}
// case: integer_methods_unsigned_neg
// error: 'u8' has no method 'saturatingNeg': an unsigned number is never negated past its range; use 'checkedNeg' or 'wrappingNeg'
function main() {
  const x: u8 = 1;
  console.log(x.saturatingNeg());
}
// case: integer_methods_operand_type
// error: 'checkedAdd' on 'u8' takes a 'u8', not 'i64'; convert it with 'as', as in 'n as u8'
function main() {
  const x: u8 = 1;
  const y = 2;
  console.log(x.checkedAdd(y));
}
// case: integer_methods_shift_operand
// error: 'wrappingShl' on 'i64' takes a 'u32', not 'i64'; convert it with 'as', as in 'n as u32'
function main() {
  const x = 1;
  console.log(x.wrappingShl(x));
}
// case: integer_methods_arity
// error: 'checkedNeg' takes no argument
function main() {
  const x = 1;
  console.log(x.checkedNeg(1));
}
// case: integer_methods_no_saturating_rem
// error: 'i64' has no method 'saturatingRem'
// Rust has no saturating remainder: a remainder never overflows but at MIN % -1.
function main() {
  const x = 1;
  console.log(x.saturatingRem(2));
}
// case: integer_methods_comptime
// expect: null -128 127 -128 true | null 127 -128 127 true | null -2 -128 -2 true | null -128 127 | null -128 127 null 0 | null -128 null -16 -32 -4 | null 1 -128 127 -128 127 -1 | 0 255 null 1 254 255 null 15 null 217 255
// expect: null -128 127 -128 true | null 127 -128 127 true | null -2 -128 -2 true | null -128 127 | null -128 127 null 0 | null -128 null -16 -32 -4 | null 1 -128 127 -128 127 -1 | 0 255 null 1 254 255 null 15 null 217 255
// Comptime computes every method as the program does.
function o(v: i8 | null): string {
  if (v === null) return "null";
  return `${v}`;
}
function u(v: u8 | null): string {
  if (v === null) return "null";
  return `${v}`;
}
function all(): string {
  const max: i8 = 127;
  const min: i8 = -128;
  const add = max.overflowingAdd(1);
  const sub = min.overflowingSub(1);
  const mul = max.overflowingMul(2);
  const signed =
    `${o(max.checkedAdd(1))} ${max.wrappingAdd(1)} ${max.saturatingAdd(1)} ${add[0]} ${add[1]} | ` +
    `${o(min.checkedSub(1))} ${min.wrappingSub(1)} ${min.saturatingSub(1)} ${sub[0]} ${sub[1]} | ` +
    `${o(max.checkedMul(2))} ${max.wrappingMul(2)} ${max.saturatingMul(-2)} ${mul[0]} ${mul[1]} | ` +
    `${o(min.checkedNeg())} ${min.wrappingNeg()} ${min.saturatingNeg()} | ` +
    `${o(min.checkedDiv(-1))} ${min.wrappingDiv(-1)} ${min.saturatingDiv(-1)} ${o(min.checkedRem(-1))} ${min.wrappingRem(-1)} | ` +
    `${o(max.checkedShl(8))} ${o(max.checkedShl(7) ?? 9)} ${o(min.checkedShr(8))} ${(-16 as i8).wrappingShl(8)} ${(-16 as i8).wrappingShl(9)} ${(-16 as i8).wrappingShr(10)} | ` +
    `${o((2 as i8).checkedPow(7))} ${o((2 as i8).checkedPow(0))} ${(2 as i8).wrappingPow(7)} ${(2 as i8).saturatingPow(7)} ${(-2 as i8).saturatingPow(9)} ${(-2 as i8).saturatingPow(8)} ${(-1 as i8).wrappingPow(4294967295)}`;
  const umax: u8 = 255;
  const zero: u8 = 0;
  const three: u8 = 3;
  const unsigned = `${umax.wrappingAdd(1)} ${zero.wrappingSub(1)} ${u(zero.checkedSub(1))} ${u(umax.checkedNeg() ?? 1)} ${umax.wrappingMul(2)} ${umax.saturatingMul(2)} ${u(umax.checkedDiv(0))} ${umax.wrappingShr(12)} ${u(three.checkedPow(6))} ${three.wrappingPow(6)} ${three.saturatingPow(6)}`;
  return `${signed} | ${unsigned}`;
}
function main() {
  console.log(all());
  console.log(comptime all());
}
// case: integer_methods_comptime_divide_by_zero
// error: this comptime code panicked: attempt to divide by zero
function grow(): i64 {
  const x = 1;
  return x.wrappingDiv(0);
}
function main() { console.log(comptime grow()); }
