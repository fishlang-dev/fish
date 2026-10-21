// Once a closure's last call is past, what it captured is free again.
function main() {
  let x = 1
  const g = () => x
  print(g())
  x = 2
  print(x)
}
// expect: 1
// expect: 2
