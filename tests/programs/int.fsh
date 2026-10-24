// case: int_i64_min
// The smallest i64 can be written as a literal.
function main() {
  const a: i64 = -9223372036854775808
  const b: isize = -9223372036854775808
  print(a, b)
}
// expect: -9223372036854775808 -9223372036854775808
// case: int_i8_divide_overflow
// The smallest i8 divided by -1 overflows.
function main() {
  let a: i8 = -128
  let b: i8 = -1
  print(a / b)
}
// panic: attempt to divide with overflow
// case: int_literal_range
// A literal must fit the type it is written for.
function main() {
  let b: u8 = 300
}
// error: '300' doesn't fit in 'u8', which holds 0 to 255
// case: int_mixed
// Numbers of different types don't mix without 'as'.
function main() {
  let a: u8 = 1
  let b: i32 = 2
  print(a + b)
}
// error: operator '+' can't mix 'u8' and 'i32'; convert one side with 'as'
// case: int_negate_unsigned
// An unsigned value can't be negated.
function main() {
  let a: u8 = 1
  print(-a)
}
// error: 'u8' is unsigned, so it can't be negated
// case: int_negative_unsigned
// An unsigned type can't hold a negative literal.
function main() {
  let y: u8 = -1
}
// error: 'u8' is unsigned, so it can't be negative
// case: int_sized
// Sized integers: literals typed where they are written, operators at each width and
// signedness, printing, unions, typeof and switch.
type P = { x: u16; y: i8 }
function half(v: u16): u16 { return v / 2 }
function main() {
  let a: u8 = 200
  print(a, a + 1, a < 10, a === 200)
  print(half(7), half(65535))
  const big: u64 = 18446744073709551615
  print(big, big / 2)
  const p: P = { x: 300, y: -128 }
  print(p.x, p.y)
  let m: i8 = -100
  m -= 28
  print(m, -(m + 1))
  let u: u32 = 4294967295
  print(u >> 4, u >>> 4)
  let s: i32 = -16
  print(s >> 2, s >>> 28, s & 0xff, ~s)
  let w: u8 | boolean = 7
  print(w, typeof a === "number")
  switch (a) {
    case 200:
      print("two hundred")
  }
  let k: usize = 3
  k++
  print(k)
}
// expect: 200 201 false true
// expect: 3 32767
// expect: 18446744073709551615 9223372036854775807
// expect: 300 -128
// expect: -128 127
// expect: 268435455 268435455
// expect: -4 15 240 15
// expect: 7 true
// expect: two hundred
// expect: 4
// case: int_switch_union
// A switch case literal takes a union's one number type.
function main() {
  const i: u8 | boolean = 200
  switch (i) { case 200: print("hit"); break; default: print("miss") }
}
// expect: hit
// case: int_u8_overflow
// A u8 overflows past 255.
function main() {
  let a: u8 = 255
  print(a + 1)
}
// panic: attempt to add with overflow
// case: int_u8_wrap
// In release builds a u8 wraps.
// mode: release
function main() {
  let a: u8 = 255
  print(a + 1)
}
// expect: 0
// case: int_variable_no_adapt
// A variable of literals takes the type its first use demands, and keeps it after.
function main() {
  let x = 5
  let a: u16 = x
  let y: u8 = x
}
// error: type 'u16' is not assignable to type 'u8'; convert it with 'as u8'
