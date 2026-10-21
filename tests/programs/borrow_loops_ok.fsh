// A reference declared in a loop body starts fresh each pass, an assignment changes its
// target after reading its value, and a mutable receiver can be read by its own arguments.
type P = { x: i64 }

class V {
  n: i64 = 0
  add(this: Mut<this>, k: i64) {
    this.n = this.n + k
  }
}

function poke(m: Mut<P>): i64 {
  return m.x + 1
}

function main() {
  let p: P = { x: 1 }
  let total = 0
  let i = 0
  while (i < 3) {
    let m: Mut<P> = p
    total = total + poke(m)
    p.x = i
    const r: Ref<P> = p
    total = total + r.x
    i++
  }
  for (let j = 0; j < 2; p.x++) {
    const r: Ref<P> = p
    total = total + r.x
    j++
  }
  const s: Ref<P> = p
  p.x = s.x + 1
  let v = new V()
  v.add(v.n + 1)
  v.add(v.n + 1)
  print(total, p.x, v.n)
}
// expect: 13 5 3
