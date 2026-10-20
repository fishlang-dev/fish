// A generic function nothing calls is still checked, and compiles to nothing.
function id<T, U>(x: i64): i64 {
  return x
}

function main() {
  print(id(1))
}
// error: can't infer a type for 'T'; pass the type arguments explicitly
