type Inner = { v: i64 }
type Pair = { left: Inner; right: Inner }

function main() {
  const p: Pair = { left: { v: 1 }, right: { v: 2 } }
  const l = p.left
  print(p.left.v, l.v)
}
// error: 'p.left.v' can't be used here because 'p.left' was moved
