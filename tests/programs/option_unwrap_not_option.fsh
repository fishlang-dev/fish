// '!' needs an Option.
function main() {
  const n = 5
  print(n!)
}
// error: '!' takes the value out of an Option, and this is a 'i64', which is never empty
