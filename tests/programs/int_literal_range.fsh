// A literal must fit the type it is written for.
function main() {
  let b: u8 = 300
}
// error: '300' doesn't fit in 'u8', which holds 0 to 255
