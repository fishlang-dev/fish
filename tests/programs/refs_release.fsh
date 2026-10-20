// mode: release
// References behave the same in a release build.
type P = { x: i64; y: i64 }

function sum(p: Ref<P>): i64 {
  return p.x + p.y
}

function main() {
  const p: P = { x: 3, y: 4 }
  print(sum(p), sum({ x: 1, y: 1 }), p.y)
}
// expect: 7 2 4
