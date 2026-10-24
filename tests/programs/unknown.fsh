// case: unknown_function
function main() {
  greet()  // error: unknown function 'greet'
}
// case: unknown_label
function main() {
  while (false) {
    break nowhere
  }
}
// error: cannot find label 'nowhere'
// case: unknown_name
function main() {
  print(missing)  // error: cannot find name 'missing'
}
