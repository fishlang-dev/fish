type Inner = { v: i64 }
type Pair = { left: Inner; right: Inner }

function take(p: Pair): i64 {
  return p.left.v
}

function main() {
  let p: Pair = { left: { v: 1 }, right: { v: 2 } }
  take(p)
  p.left = { v: 3 }
}
// error: can't assign to 'p.left' because 'p' was moved
