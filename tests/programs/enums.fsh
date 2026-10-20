enum Color {
  Red,
  Green = 5,
  Blue,
}

enum Dir {
  Up = "UP",
  Down = "DOWN",
}

enum Signed {
  Low = -2,
  Mid,
}

function name(c: Color): i64 {
  switch (c) {
    case Color.Red:
      return 1
    case Color.Green:
      return 2
    default:
      return 3
  }
}

function flip(d: Dir): Dir {
  return d === Dir.Up ? Dir.Down : Dir.Up
}

function main() {
  const c: Color = Color.Blue
  print(Color.Red, Color.Green, c, Signed.Low, Signed.Mid)
  print(name(Color.Red), name(Color.Green), name(c))
  print(Dir.Up, flip(Dir.Up), flip(Dir.Down))
  // A numeric enum reads as an i64.
  const n: i64 = c
  print(n + 1, Color.Green * 2, c === Color.Blue, c !== Color.Red)
  let d: Dir = Dir.Down
  d = Dir.Up
  print(d)
}
// expect: 0 5 6 -2 -1
// expect: 1 2 3
// expect: UP DOWN UP
// expect: 7 10 true true
// expect: UP
