enum E {
  A(i64),
  B,
}

function main() {
  const x = E.B();
}
// error: 'E.B' holds nothing, so it isn't called; write 'E.B'
