// Options through references: written, cleared, narrowed and read with '??'.
type P = { x: i64; o?: i64 }
function setO(p: Mut<P>, v: i64) { p.o = v }
function clear(k: Mut<i64 | null>) { k = null }
function put(k: Mut<i64 | null>, v: i64) { k = v }
function bumpIf(k: Mut<i64 | null>) { if (k !== null) k = k + 1 }
function read(k: Ref<i64 | null>): i64 { return k ?? -1 }
function main() {
  let p: P = { x: 1 }
  setO(p, 5)
  print(p.o)
  let n: i64 | null = 3
  bumpIf(n)
  print(n, read(n))
  clear(n)
  print(n, read(n))
  put(n, 8)
  print(n)
}
// expect: 5
// expect: 4 4
// expect: null -1
// expect: 8
