// expect: 1
// expect: 2
// expect: done
// expect: end
function f(n: i64): i64 throws i64 { if (n < 0) throw n; return n }
function main() {
  let outer: string[] = ["o"];
  const o: Ref<string[]> = outer;
  let h = { r: o };
  console.log(h.r.length);
  try {
    let x: string[] = ["a" + 1, "x"];
    h = { r: x };
    console.log(h.r.length);
    f(-1);
  } catch {} finally {
    console.log("done");
  }
  console.log("end");
}
