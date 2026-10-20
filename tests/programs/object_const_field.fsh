function main() {
  const p = { inner: { n: 1 } }
  p.inner.n = 2
}
// error: cannot assign to 'p.inner.n' because 'p' is a constant
