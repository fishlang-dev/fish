// A literal takes its type only where it is written, so a variable keeps i64.
function main() {
  let x = 5
  let y: u8 = x
}
// error: type 'i64' is not assignable to type 'u8'; convert it with 'as u8'
