type Pair<T> = { first: T; second: T }
type Named<T> = { name: i64; value: T }

function swap(p: Pair<i64>): Pair<i64> {
  return { first: p.second, second: p.first }
}

function main() {
  const p: Pair<i64> = { first: 1, second: 2 }
  const q = swap(p)
  const n: Named<Pair<boolean>> = { name: 3, value: { first: true, second: false } }
  print(q.first, q.second, n.name, n.value.second)
}
// expect: 2 1 3 false
