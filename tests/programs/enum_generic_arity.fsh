enum R<T, E> {
  Ok(T),
  Err(E),
}

function main() {
  const x: R<i64> = R.Ok(1);
}
// error: enum 'R' takes 2 type arguments
