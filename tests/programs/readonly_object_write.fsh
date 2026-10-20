type Point = { readonly x: i64; y: i64 }

function main() {
  let p: Point = { x: 1, y: 2 }
  p.x = 3
}
// error: cannot assign to 'x' because it is a read-only property
