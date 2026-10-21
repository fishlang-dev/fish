type Box = { s: string };
function take(b: Box): string { return b.s; }
function main() {
  const b: Box = { s: "a" + "b" };
  console.log(take(b));
  const ys = [b];
  console.log(ys[0].s);
}
// error: 'b' was moved, so it can't be used here
