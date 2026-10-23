// error: 'x' doesn't live long enough: 'h' still borrows it after its block ends
function f(n: i64): i64 throws i64 { if (n < 0) throw n; return n }
function main() {
  let outer: string[] = ["o"];
  const o: Ref<string[]> = outer;
  let h = { r: o };
  try {
    let x: string[] = ["a" + 1, "x"];
    h = { r: x };
    f(-1);
    h = { r: o };
  } catch (e) {
    let junk: string[] = [];
    for (let i = 0; i < 100; i++) junk.push("junk" + i);
    console.log(h.r.length, h.r[0]);
  }
}
