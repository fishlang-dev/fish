type Box = { name: string };
function both(a: Ref<Box>, k: i64): string { return a.name + k; }
function main() {
  let xs = ["a", "b"];
  console.log(xs |> %.length + (xs = ["c"]).length + %.length);
}
// error: cannot change 'xs' while '%' borrows 'xs' and is used later
