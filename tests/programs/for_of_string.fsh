// expect: [a:1][é:1][€:1][😀:2][!:1] 5
// expect: a
// expect: c
// expect: xx
// expect: yy
// for...of over a string gives each code point as a string, as JavaScript's iterator does;
// break and continue work, and a let variable may change.
function main() {
  const s = "aé€😀" + "!";
  let out = "";
  let n = 0;
  for (const ch of s) {
    out += `[${ch}:${ch.length}]`;
    n++;
  }
  console.log(out, n);
  for (const c of "abc") {
    if (c === "b") continue;
    console.log(c);
  }
  let t = "xyz" + 1;
  for (let c of t) {
    if (c === "z") break;
    c = c + c;
    console.log(c);
  }
}
