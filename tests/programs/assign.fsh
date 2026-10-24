// case: assign_call_field
function origin() {
  return { x: 0 }
}

function main() {
  origin().x = 1
}
// error: can only assign to a variable or a field
// case: assign_operator
// '**=' assigns a power.
function main() {
  let x = 2
  x **= 3
  print(x)
}
// expect: 8
