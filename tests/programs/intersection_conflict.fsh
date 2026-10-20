type A = { a: i64 }
type B = { a: boolean }

function main() {
  const x: A & B = { a: 1 }
}
// error: property 'a' has type 'i64' on one side of '&' and 'boolean' on the other
