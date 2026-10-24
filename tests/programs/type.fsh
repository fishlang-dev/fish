// case: type_alias
type Count = i64
type Total = Count
type Flag = boolean

function twice(n: Count): Total {
  return n * 2
}

function main() {
  const ready: Flag = true
  const n: Total = twice(21)
  print(n, ready)
}
// expect: 42 true
// case: type_alias_builtin
type i64 = boolean

function main() {}
// error: 'i64' is a built-in type
// case: type_alias_cycle
type A = B
type B = A

function main() {}
// error: type 'A' refers to itself, so it would have infinite size
// case: type_alias_duplicate
type Count = i64
type Count = boolean

function main() {}
// error: duplicate type name 'Count'
// case: type_alias_generic
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
// case: type_alias_local
// expect: 3
function main() {
  type Count = i64
  const c: Count = 3
  console.log(c)
}
// case: type_alias_recursive
type Node = { value: i64; next: Node }

function main() {}
// error: type 'Node' refers to itself, so it would have infinite size
// case: type_as_name
function main() {
  let type = 1
  print(type)
  type
    += 1
  print(type)
}
// expect: 1
// expect: 2
// case: type_newline_bracket
// mode: parse
// The `[` starts a new statement, so this is an alias and then an array literal. Read as
// one indexed type, `B[1, 2]` would fail at the comma.
function main() {
  type A = B
  [1, 2]
}
// case: type_newline_extends
// mode: parse
function main() {
  type A = B
  extends(1)
}
// error: expected an expression, found 'extends'
