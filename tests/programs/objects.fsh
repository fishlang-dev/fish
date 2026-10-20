type Point = { x: i64; y: i64 }
type Segment = { from: Point; to: Point; visible: boolean }

function point(x: i64, y: i64): Point {
  return { x, y }
}

function length2(s: Segment): i64 {
  const dx = s.to.x - s.from.x
  const dy = s.to.y - s.from.y
  return dx * dx + dy * dy
}

function origin() {
  return { y: 0, x: 0 }
}

function main() {
  const a = point(1, 2)
  print(a.x, a.y)
  const s: Segment = { visible: true, from: origin(), to: { x: 3, y: 4 } }
  print(length2(s.clone()), s.visible, s.to.y)
  print(point(5, 6).y, origin().x)
  // Field order doesn't matter: these are the same type.
  const b: { y: i64; x: i64 } = a.clone()
  print(b.x)
  // A clone is independent of its source.
  let c = a.clone()
  c = point(9, 9)
  print(a.x, c.x)
  const empty = {}
  const nested = { inner: { deeper: { n: 7 } } }
  print(nested.inner.deeper.n)
  const picked = a.x > 0 ? a : c
  print(picked.y)
}
// expect: 1 2
// expect: 25 true 4
// expect: 6 0
// expect: 1
// expect: 1 9
// expect: 7
// expect: 2
