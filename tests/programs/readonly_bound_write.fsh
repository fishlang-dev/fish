interface Named {
  readonly id: i64
}

function rename(n: Named): i64 {
  let copy = n
  copy.id = 5
  return copy.id
}

function main() {
  print(rename({ id: 1 }))
}
// error: cannot assign to 'id' because it is a read-only property
