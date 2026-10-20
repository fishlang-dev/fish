// A field can be moved out of a variable or parameter that owns it; the other fields stay
// usable, and assigning the moved field makes the whole usable again.
type Inner = { v: i64 }
type Pair = { left: Inner; right: Inner; n: i64 }

function take(i: Inner): i64 {
  return i.v
}

function split(p: Pair): i64 {
  const l = take(p.left)
  return l * 10 + p.right.v + p.n
}

function whole(p: Pair): i64 {
  return p.left.v + p.right.v
}

function main() {
  let p: Pair = { left: { v: 1 }, right: { v: 2 }, n: 3 }
  const a = take(p.left)
  const b = p.right.v + p.n
  p.left = { v: 4 }
  print(a, b, whole(p), split({ left: { v: 5 }, right: { v: 6 }, n: 7 }))
}
// expect: 1 5 6 63
