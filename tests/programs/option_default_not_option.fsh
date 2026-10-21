// '??' needs an Option on its left.
function main() {
  const n = 5
  print(n ?? 1)
}
// error: the left side of '??' is a 'i64', which is never empty
