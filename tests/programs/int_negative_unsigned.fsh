// An unsigned type can't hold a negative literal.
function main() {
  let y: u8 = -1
}
// error: 'u8' is unsigned, so it can't be negative
