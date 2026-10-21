// A move closure changes its own copy of a let.
function main() {
  let n: u8 = 1
  const g = move () => {
    n++
    print(n)
  }
  g()
  g()
  print(n)
}
// expect: 2
// expect: 3
// expect: 1
