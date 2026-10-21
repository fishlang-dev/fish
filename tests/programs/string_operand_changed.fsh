function bump(s: Mut<string>): string {
  s = "new" + 1;
  return "r";
}

function main() {
  let s = "old" + 1;
  const t = s + bump(s);
  console.log(t, s);
  let u = "u" + 1;
  console.log(u, (u = "v" + 2));
  let w = "w" + 1;
  console.log(`${w}-${bump(w)}-${w}`, w === bump(w), w);
  let k = "k" + 1;
  k += bump(k);
  console.log(k);
}
// expect: old1r new1
// expect: u1 v2
// expect: w1-r-new1 false new1
// expect: k1r
