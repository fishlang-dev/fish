type Point = { x: i64; y: i64 }

function main() {
  let p: Point = { x: 1, y: 2 }
  p.x = 10
  p.y += 5
  p.x++
  print(p.x, p.y)
  let line = { from: p.clone(), to: { x: 0, y: 0 }, label: { visible: false } }
  line.to.x = 3
  line.from.y *= 2
  line.label.visible = true
  ++line.to.y
  print(line.from.x, line.from.y, line.to.x, line.to.y, line.label.visible)
  // The line holds a copy: changing it leaves p alone.
  print(p.y)
  line.to = { x: 8, y: 9 }
  print(line.to.x, line.to.y)
  print(p.x = 4, p.x)
}
// expect: 11 7
// expect: 11 14 3 1 true
// expect: 7
// expect: 8 9
// expect: 4 4
