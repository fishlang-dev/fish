// A move closure can't change its copy of a constant.
function main() {
  const n: u8 = 1
  const g = move () => { n++; print(n) }
  g()
  g()
  print(n)
}
// error: cannot assign to 'n' in this closure because 'n' is a constant; declare it with 'let'
