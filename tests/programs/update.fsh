// case: update_boolean
function main() {
  let done = false
  done++
}
// error: operator '++' cannot be applied to type 'boolean'
// case: update_constant
function main() {
  const n = 1
  print(n++)
}
// error: cannot assign to 'n' because it is a constant
