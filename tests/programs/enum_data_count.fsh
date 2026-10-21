enum E {
  A(i64, i64),
}

function main() {
  const x = E.A(1);
}
// error: 'E.A' holds 2 values, but 1 was given
