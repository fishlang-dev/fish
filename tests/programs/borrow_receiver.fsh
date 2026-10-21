type P = { x: i64 }

class Box {
  p: P = { x: 1 }
  look(q: P): i64 {
    return this.p.x + q.x
  }
}

function main() {
  let b = new Box()
  print(b.look(b.p))
}
// error: cannot move 'b.p' while 'b' is lent to 'look' for this call
