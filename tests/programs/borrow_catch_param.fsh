// error: 'e' doesn't live long enough
function f(n: string[]): i64 throws string[] { if (n.length > 0) throw n; return 1 }
function main() {
  let outer: string[] = ["o"];
  const o: Ref<string[]> = outer;
  let h = { r: o };
  try {
    f(["e" + 1, "x"]);
  } catch (e) {
    h = { r: e };
  }
  let junk: string[] = [];
  for (let i = 0; i < 100; i++) junk.push("junk" + i);
  console.log(h.r.length, h.r[0], junk.length);
}
