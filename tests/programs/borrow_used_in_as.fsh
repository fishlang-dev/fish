function main() {
  let xs: i64[] = [1];
  const r: Ref<i64> = xs[0];
  xs.push(2);
  console.log(r as i32);
}
// error: cannot change 'xs' while 'r' borrows 'xs[...]' and is used later
