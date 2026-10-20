function make(): i64 {
  return 1
}

function main() {
  new make()
}
// error: only a class can be constructed with 'new'
