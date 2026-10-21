enum E {
  A(i64),
  B,
}

function main() {
  const x = E.A;
}
// error: 'E.A' holds a value; build it with 'E.A(...)'
