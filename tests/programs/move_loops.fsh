// Declarations inside a loop are fresh each pass; `while (true)` ends only by its `break`;
// `do...while`, labels and Copy values passed twice all behave.
type P = { x: i64 }

enum Color {
  Red,
  Green,
}

function take(p: P): i64 {
  return p.x
}

function shade(c: Color, n: 1 | 2): i64 {
  return c === Color.Green ? n : 0
}

function main() {
  let total = 0
  let i = 0
  while (i < 3) {
    const q: P = { x: i }
    total = total + take(q)
    for (let r: P = { x: 1 }; r.x < 2; r = { x: r.x + 1 }) {
      total = total + 1
    }
    i++
  }
  let p: P = { x: 0 }
  let n = 0
  while (true) {
    p = { x: n }
    n++
    if (n > 3) {
      break
    }
    total = total + take(p)
  }
  let k = 0
  do {
    const d: P = { x: k }
    total = total + take(d)
    k++
  } while (k < 2)
  outer: for (let a = 0; a < 2; a++) {
    for (let b = 0; b < 2; b++) {
      const e: P = { x: 10 }
      if (b === 1) {
        continue outer
      }
      total = total + take(e)
    }
  }
  const c = Color.Green
  const one: 1 | 2 = 2
  print(total, p.x, shade(c, one) + shade(c, one))
}
// expect: 30 3 4
