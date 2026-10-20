// A newline before `++` ends the statement, so the `++` applies to `y` on the next line.
function main() {
  let y = 1
  print(y)
  ++y
  print(y)
}
// expect: 1
// expect: 2
