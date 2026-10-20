// `x == 2` must never parse as an assignment.
function main() {
  let x = 1
  x == 2  // error: '==' is not supported; use '==='
}
