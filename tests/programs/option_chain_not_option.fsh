// '?.' reads through an Option.
type P = { x: i64 }
function main() {
  const p: P = { x: 1 }
  print(p?.x)
}
// error: '?.' reads through an Option, and this is a '{ x: i64 }', which is never empty; use '.'
