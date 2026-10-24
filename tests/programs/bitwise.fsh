// case: bitwise
function main() {
  print(12 & 10, 12 | 10, 12 ^ 10, ~0, ~5)
  print(1 << 10, -8 >> 1, -8 >>> 60, 8 >>> 1)
  print(1 << 63)
  let flags = 1
  flags |= 4
  flags &= ~1
  flags ^= 6
  flags <<= 3
  flags >>= 1
  flags >>>= 1
  print(flags)
  let ready = false
  let calls = 0
  ready &&= (calls++ > 0)
  print(ready, calls)
  ready ||= (calls++ === 0)
  print(ready, calls)
  ready ||= (calls++ === 0)
  print(ready, calls)
}
// expect: 8 14 6 -1 -6
// expect: 1024 -4 15 4
// expect: -9223372036854775808
// expect: 4
// expect: false 0
// expect: true 1
// expect: true 1
// case: bitwise_booleans
function main() {
  print(true & false)
}
// error: operator '&' can't be applied to booleans; use '&&'
