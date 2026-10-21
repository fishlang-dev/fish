// A closure can't assign a captured parameter, as the body can't.
function f(x: i64) {
  const g = () => { x = 2 }
}
function main() {}
// error: assigning to a parameter is not supported yet; copy it into a 'let'
