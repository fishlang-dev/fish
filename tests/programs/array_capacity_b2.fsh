// error: cannot change 'xs' while a 'for...of' loop is reading 'xs'
function main() {
  let xs = ["a" + "1", "b" + "2"];
  for (const x of xs) { xs.reserve(100); console.log(x); }
}
