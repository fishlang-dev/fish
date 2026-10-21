type P = { n: i64 };
enum E {
  A(P),
  B,
}

function main() {
  const x = E.A({ n: 1 });
  const y = x;
  const z = x;
}
// error: 'x' was moved, so it can't be used here
