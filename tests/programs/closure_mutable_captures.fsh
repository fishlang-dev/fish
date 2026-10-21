// A closure that changes what it captures captures it mutably: counters, a mutating method
// on a capture or on `this`, lending a capture on, and through a nested closure.
class Counter {
  n = 0
  bump(this: Mut<this>) { this.n++ }
  twice(this: Mut<this>): i64 {
    const go = () => this.bump()
    go()
    go()
    return this.n
  }
}
function poke(m: Mut<i64>) { m += 100 }
function each(n: i64, f: (i: i64) => void) {
  let i = 0
  while (i < n) {
    f(i)
    i++
  }
}
function main() {
  let count = 0
  const inc = () => { count++ }
  inc()
  inc()
  print(count)
  let sum = 0
  each(4, (i) => { sum += i })
  print(sum)
  let c = new Counter()
  const tick = () => c.bump()
  tick()
  print(c.n, new Counter().twice())
  let k = 1
  const lend = () => poke(k)
  lend()
  print(k)
  let outer = 0
  const nest = () => {
    const deeper = () => { outer = outer + 5 }
    deeper()
  }
  nest()
  print(outer)
}
// expect: 2
// expect: 6
// expect: 1 2
// expect: 101
// expect: 5
