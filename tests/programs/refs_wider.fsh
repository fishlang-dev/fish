type P = { x: i64 }

function look(r: Ref<{ x: i64 }>): i64 {
  const l: Ref<P> = r
  return l.x
}

function main() {
  const wide = { x: 1, y: 2 }
  print(look(wide))
}
// error: a reference can only lend the exact type it points to, which may be wider here
