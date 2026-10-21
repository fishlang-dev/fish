// A never value is never read: code after a throw expression doesn't run.
function main() throws i64 {
  let x = throw 1
  let y: i64 = x
  print(y)
}
// fails: Error: 1
