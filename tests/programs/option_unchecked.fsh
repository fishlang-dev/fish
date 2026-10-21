// An Option's value is used once it is checked.
function main() {
  const x: i64 | null = 1
  print(x + 1)
}
// error: operator '+' can't use the Option 'i64 | null' until it is checked
