function origin() {
  return { x: 0 }
}

function main() {
  origin().x = 1
}
// error: can only assign to a variable or a field
