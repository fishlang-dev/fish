function main() {
  let xs: i64[] = [1];
  const r: Ref<i64> = xs[0];
  const y = (xs = [5]).length as i32;
  console.log(r, y);
}
// error: cannot change 'xs' while 'r' borrows
