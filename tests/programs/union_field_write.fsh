function main() {
  let x: { n: i64; a: boolean } | { n: i64 } = { n: 1 }
  x.n = 5
}
// error: can't assign to 'n' through '{ a: boolean; n: i64 } | { n: i64 }'; narrow it to one member first
