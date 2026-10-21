function add(xs: readonly i64[]) {
  xs.push(1);
}

function main() {
  let a = [1];
  add(a);
}
// error: cannot push to 'xs' because 'xs' is a shared reference ('Ref'), which only reads
