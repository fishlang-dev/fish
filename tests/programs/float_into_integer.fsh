// A float literal doesn't become an integer.
function main() {
  const i: i32 = 1.5
}
// error: type 'number' is not assignable to type 'i32'; convert it with 'as i32'
