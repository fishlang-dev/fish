// error: 'xs[0]' is borrowed mutably and shared in one value, which would let one change what the other reads
function main() {
  let xs: string[] = ["a" + 1];
  let o: { a: { m: Mut<string[]> }; b: Ref<string> } = { a: { m: xs }, b: xs[0] };
  let i = 0;
  while (i < 100) { o.a.m.push("p" + i); i += 1; }
  o.a.m[0] = "gone" + 1;
  console.log(o.b);
}
