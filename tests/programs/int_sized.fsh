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
