// A literal thrown takes the declared error type.
function g(): i64 throws u8 {
  throw 200
}
function main() throws u8 { print(g()) }
// fails: Error: 200
