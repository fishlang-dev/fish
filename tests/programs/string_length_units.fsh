function main() {
  const a = "hello";
  const b: string = "héllo wörld";
  const c = "日本語";
  const d = "a😀b";
  console.log(a.length, b.length, c.length, d.length, "".length);
  console.log(a.charCodeAt(1), b.charCodeAt(1), c.charCodeAt(2), d.charCodeAt(1), d.charCodeAt(2), d.charCodeAt(3));
  let long = "";
  for (let i = 0; i < 70; i++) long += "é😀";
  const lit = "ééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééé😀ééééééééééééééééééééééééééééééééééééééééééééé😀x";
  console.log(long.length, long.charCodeAt(0), long.charCodeAt(129), long.charCodeAt(130), long.charCodeAt(209));
  console.log(lit.length, lit.charCodeAt(72), lit.charCodeAt(73), lit.charCodeAt(74), lit.charCodeAt(lit.length - 1));
  let sum: u32 = 0;
  for (let i = 0; i < d.length; i++) sum += d.charCodeAt(i) as u32;
  console.log(sum);
}
// expect: 5 11 3 4 0
// expect: 101 233 35486 55357 56832 98
// expect: 210 233 233 55357 56832
// expect: 123 233 55357 56832 120
// expect: 112384
