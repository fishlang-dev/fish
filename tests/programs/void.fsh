// case: void_return_value
function f(): void {
  return 1  // error: type 'i64' is not assignable to return type 'void'
}

function main() {
  f()
}
// case: void_value
function nothing() {
}

function main() {
  const x = nothing()  // error: 'nothing' does not return a value
}
