// A thrown value must fit the declared error type.
function g(): i64 throws u8 {
  throw true
}
function main() {}
// error: this 'throw' throws 'boolean', which isn't the 'u8' that 'g' throws; convert it to 'u8'
