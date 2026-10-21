// A closure changing a capture moves rather than copies.
function main() {
  let n = 1
  const bump = () => { n++ }
  const other = bump
  bump()
}
// error: 'bump' was moved, so it can't be used here
