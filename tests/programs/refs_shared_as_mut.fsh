type P = { x: i64 }

function poke(m: Mut<i64>): i64 {
  return 1
}

function look(r: Ref<i64>): i64 {
  return poke(r)
}

function main() {
  print(look(3))
}
// error: a shared reference can't lend itself as mutable
