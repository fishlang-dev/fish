// A shared reference to a wider value lends a copy of the part a narrower reference wants.
type P = { x: i64 }

function exact(r: Ref<P>): i64 {
  return r.x
}

function look(r: Ref<{ x: i64 }>): i64 {
  const l: Ref<P> = r
  return l.x + exact(r)
}

function main() {
  const wide = { x: 1, y: 2 }
  print(look(wide), look({ x: 3 }))
}
// expect: 2 6
