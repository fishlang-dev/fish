// A variable of literals takes the type its first use demands, and keeps it after.
function main() {
  let x = 5
  let a: u16 = x
  let y: u8 = x
}
// error: type 'u16' is not assignable to type 'u8'; convert it with 'as u8'
