// A closure's parameter needs a type when nothing gives it one.
function main() {
  const f = (a) => a
}
// error: parameter 'a' implicitly has an 'any' type; add a type annotation
