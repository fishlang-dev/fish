enum E {
  A(i64),
}

function main() {
  const x = E.A("s");
}
// error: argument of type '"s"' is not assignable to 'E.A', which holds 'i64'
