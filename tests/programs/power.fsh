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
