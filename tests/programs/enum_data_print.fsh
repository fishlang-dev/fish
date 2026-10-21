enum E {
  A(i64),
  B,
}

function main() {
  console.log(E.B);
}
// error: printing an enum that holds data is not supported yet
