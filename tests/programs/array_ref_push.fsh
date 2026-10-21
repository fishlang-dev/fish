function look(xs: Ref<i64[]>) {
  xs.push(1);
}

function main() {
  let a = [1];
  look(a);
}
// error: cannot push to 'xs' because 'xs' is a shared reference ('Ref'), which only reads
