type Box = { s: string };
function main() {
  let xs: Box[] = [{ s: "a" + "1" }];
  const r: Ref<Box> = xs[0];
  xs[0] = { s: "z" + "9" };
  xs.push({ s: "b" + "2" });
  xs.push({ s: "c" + "3" });
  const ys = [r.s];
  console.log(ys[0]);
}
// error: cannot change 'xs[0]' while 'r' borrows
