function f(p: { inner: { n: i64 } }) {}

function main() {
  f({ inner: { n: 1, m: 2 } })
}
// error: object literal may only specify known properties, and 'm' does not exist in type '{ n: i64 }'
