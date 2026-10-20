// A move counts only on the paths it happens on: a branch that leaves takes its move with it,
// and a variable assigned again each time round a loop can be moved each time.
type Point = { x: i64 }

function take(p: Point): i64 {
  return p.x
}

function pick(p: Point, early: boolean): i64 {
  if (early) {
    return take(p)
  }
  return p.x + 100
}

function main() {
  let p: Point = { x: 1 }
  let total = 0
  let i = 0
  while (i < 3) {
    total = total + take(p)
    p = { x: i + 2 }
    i++
  }
  const q: Point = { x: 7 }
  for (let j = 0; j < 5; j++) {
    if (j === 2) {
      total = total + take(q)
      break
    }
  }
  const r: Point = { x: 9 }
  switch (total) {
    case 0:
      take(r)
      break
    default:
      total = total + r.x
  }
  print(pick({ x: 4 }, true), pick({ x: 4 }, false), total, p.x)
}
// expect: 4 104 22 4
