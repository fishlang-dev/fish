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
