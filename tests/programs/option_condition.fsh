// An Option isn't a condition.
function main() {
  const x: i64 | null = 1
  if (x) print(x)
}
// error: condition must be a boolean, not the Option 'i64 | null'; check it with '!== null'
