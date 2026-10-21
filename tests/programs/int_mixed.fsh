// Numbers of different types don't mix without 'as'.
function main() {
  let a: u8 = 1
  let b: i32 = 2
  print(a + b)
}
// error: operator '+' can't mix 'u8' and 'i32'; convert one side with 'as'
