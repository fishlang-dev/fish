// case: float_bitwise
// Bitwise operators work on integers only.
function main() {
  const x: number = 2
  print(x & 1)
}
// error: operator '&' works on integers, and 'number' is a float; convert it with 'as i64' first
// case: float_into_integer
// A float literal doesn't become an integer.
function main() {
  const i: i32 = 1.5
}
// error: type 'number' is not assignable to type 'i32'; convert it with 'as i32'
// case: float_mixed
// Floats of different widths don't mix.
function main() {
  const x = 1.5
  const y: f32 = 2
  print(x + y)
}
// error: operator '+' can't mix 'number' and 'f32'
// case: float_numbers
// Floats: number and f32, literals typed where they are written, arithmetic, comparisons
// that NaN fails, and printing as JavaScript's String(x).
function area(r: number): number { return 3.14159 * r * r }
function main() {
  print(0.1 + 0.2, 1.0, 1e21, 1e-7, 123456789012345680000.0)
  const zero: number = 0
  print(1 / zero, -1 / zero, zero / zero, -zero)
  const half: number = 5 / 2
  print(half, area(2), -half, 7 % 2.5)
  const s: f32 = 0.1
  print(s, s * 3, 16777217)
  let x = 1.5
  x += 1
  x++
  print(x, x > 3, x === 4, zero / zero === zero / zero)
  const big: f32 = 3.4e38
  print(big, 100, 0.000001, 1.5e-10)
  console.log("pi is", 3.141592653589793)
}
// expect: 0.30000000000000004 1 1e+21 1e-7 123456789012345680000
// expect: Infinity -Infinity NaN 0
// expect: 2.5 12.56636 -2.5 2
// expect: 0.1 0.3 16777217
// expect: 3.5 true false false
// expect: 3.4e+38 100 0.000001 1.5e-10
// expect: pi is 3.141592653589793
// case: float_switch
// A switch on a float compares as floats do.
function main() {
  const f: f32 = 2
  switch (f) {
    case 2: print("two"); break
    default: print("other")
  }
}
// expect: two
// case: float_unions
// Floats in unions: narrowed by typeof, compared by value and printed.
type V = number | boolean
function show(v: V) {
  if (typeof v === "number") print(v * 2)
  else print(v)
}
function main() {
  const a: V = 1.25
  const b: V = true
  show(a)
  show(b)
  print(a === 1.25, a, b)
  let i: u8 | number = 3.5
  print(i)
}
// expect: 2.5
// expect: true
// expect: true 1.25 true
// expect: 3.5
