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
