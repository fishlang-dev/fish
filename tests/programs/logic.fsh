// case: logic
// The right side of && and || runs only when the left side does not decide the result.
function loud(label: i64, result: boolean): boolean {
  print("evaluated", label)
  return result
}

function main() {
  print(true && false, true || false, !true, !(1 > 2))  // expect: false true false true
  print(loud(1, false) && loud(2, true))
  // expect: evaluated 1
  // expect: false
  print(loud(3, true) || loud(4, true))
  // expect: evaluated 3
  // expect: true
  print(loud(5, true) && loud(6, false))
  // expect: evaluated 5
  // expect: evaluated 6
  // expect: false
  print(1 < 2 && 2 < 3 || false)  // expect: true
}
// case: logic_types
function main() {
  print(1 && true)  // error: operator '&&' cannot be applied to types 'i64' and 'boolean'
}
