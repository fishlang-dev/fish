type Inner = { v: i64 }
type Pair = { left: Inner; right: Inner }

function take(i: Inner): i64 {
  return i.v
}

function sum(p: Pair): i64 {
  return p.left.v + p.right.v
}

function main() {
  const p: Pair = { left: { v: 1 }, right: { v: 2 } }
  take(p.left)
  print(sum(p))
}
// error: 'p' can't be used as a whole here because 'p.left' was moved out of it
// error: note: 'p.left' moved here: passing it to 'take' hands it over
