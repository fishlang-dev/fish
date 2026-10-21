// A thrown value must fit the declared error type.
function g(): i64 throws u8 {
  throw true
}
function main() {}
// error: type 'boolean' can't be thrown here: 'g' throws 'u8'
