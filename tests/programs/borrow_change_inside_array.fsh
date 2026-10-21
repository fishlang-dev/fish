type Box = { s: string };
function main() {
  let xs: Box[] = [{ s: "a" + "1" }];
  const r: Ref<Box> = xs[0];
  const ys = [r.s, (xs[0] = { s: "z" + "9" }).s];
  console.log(ys[0], r.s);
}
// error: cannot change 'xs[0]' while 'r' borrows
