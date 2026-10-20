type Inner = { x: i64 }
type Outer = { readonly inner: Inner }

function main() {
  let o: Outer = { inner: { x: 1 } }
  o.inner.x++
}
// error: cannot assign to 'o.inner.x' because 'inner' is a read-only property
