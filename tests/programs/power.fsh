// case: power
// '**' raises an integer to a u32 power and a float to a float power.
function main() {
  print(2 ** 10, 3 ** 0, (-2) ** 3, 10 ** 18)
  const small: u8 = 2 ** 7
  let k: u32 = 5
  let b: i64 = 3
  b **= 4
  print(small, 2 ** k, b, 1 ** 4000000000)
  print(2.0 ** 0.5, 2 ** 0.5, 9 ** 0.5)
  const f: f32 = 1.5
  print(f ** 2, 0.5 ** 2)
}
// expect: 1024 1 -8 1000000000000000000
// expect: 128 32 81 1
// expect: 1.4142135623730951 1.4142135623730951 3
// expect: 2.25 0.25
// case: power_exponent_type
// An integer's exponent is a u32.
function main() {
  const x = 2
  const y = 3
  print(x ** y)
}
// error: the exponent of '**' on an integer is a 'u32', as in Rust's 'pow', not 'i64'; convert it with 'as u32'
// case: power_literals_float
// A power of literals written for a float is a float power.
function main() {
  const z: number = 2 ** -1
  print(z)
}
// expect: 0.5
// case: power_negative_exponent
// Without a float to become, a negative exponent is an error.
function main() {
  const z = 2 ** -1
}
// error: the exponent of '**' on an integer is a 'u32', which can't hold this
// case: power_overflow
// An integer power that overflows panics, as multiplying does.
function main() {
  const b: i32 = 2
  print(b ** 31)
}
// panic: attempt to multiply with overflow
// case: power_wrap
// In release builds an integer power wraps.
// mode: release
function main() {
  const b: i32 = 2
  print(b ** 31)
}
// expect: -2147483648
