// A `for` loop's initializer reference is gone by the next pass of a loop around it.
type P = { x: i64 }

function main() {
  let p: P = { x: 0 }
  let i = 0
  while (i < 3) {
    i++
    p.x = i
    let j = 0
    for (let r: Ref<P> = p; j < 1; j++) {
      print(r.x)
    }
  }
}
// expect: 1
// expect: 2
// expect: 3
