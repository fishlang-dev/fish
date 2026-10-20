type U = { kind: "a"; n: i64 } | { kind: "b"; n: i64; z: i64 }

function mutI(k: Mut<i64>): i64 {
  return k
}

function main() {
  let u: U = { kind: "a", n: 1 }
  print(mutI(u.n))
}
// error: only a place holding exactly 'i64' can be lent mutably
