// error: cannot change 'xs' while 'r' borrows 'xs[...]' and is used later
function main() {
  let xs = ["a" + "1", "b" + "2"];
  const r: Ref<string> = xs[0];
  xs.reserve(100);
  console.log(r);
}
