// error: 'x' doesn't live long enough
function f(n: i64): i64 throws i64 { if (n < 0) throw n; return n }
function g(): i64 throws i64 {
  let outer: string[] = ["o"];
  const o: Ref<string[]> = outer;
  let h = { r: o };
  try {
    let x: string[] = ["a" + 1, "x"];
    h = { r: x };
    f(-1);
    h = { r: o };
  } finally {
    let junk: string[] = [];
    for (let j = 0; j < 50; j++) junk.push("junk" + j);
    console.log(h.r.length, h.r[0]);
  }
  return 0;
}
function main() {
  try { g(); } catch (e) { console.log("caught", e); }
}
