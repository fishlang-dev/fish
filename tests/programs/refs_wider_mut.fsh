type P = { x: i64 }

function look(r: Mut<{ x: i64 }>): i64 {
  let l: Mut<P> = r
  return l.x
}

function main() {
  let wide = { x: 1, y: 2 }
  print(look(wide))
}
// error: only a reference to exactly '{ x: i64 }' can be lent mutably
