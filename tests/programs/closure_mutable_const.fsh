// A closure can't change a constant it captures.
function main() {
  const count = 0
  const inc = () => { count++ }
}
// error: cannot assign to 'count' because it is a constant
