// Bitwise operators work on integers only.
function main() {
  const x: number = 2
  print(x & 1)
}
// error: operator '&' works on integers, and 'number' is a float; convert it with 'as i64' first
