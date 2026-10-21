function main() {
  const n: u8 = 200;
  const f = 1.5;
  const s = "mid";
  console.log(`n=${n} f=${f} b=${n > 100} s=${s}!`);
  console.log(`${s}`, `plain`, `${-1}${-2}`);
  const t: string = `fixed`;
  console.log(t === "fixed");
}
// expect: n=200 f=1.5 b=true s=mid!
// expect: mid plain -1-2
// expect: true
