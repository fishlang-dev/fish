// expect: a1! true
// expect: 6 3
// A temporary array and one borrowed through a reference both work.
function make(): string[] { return ["a" + 1, "b" + 2]; }
function total(xs: Ref<i64[]>): i64 { return xs.reduce((a, x) => a + x, 0); }
function main() {
  console.log(make().map((s) => s + "!")[0], make().some((s) => s === "b2"));
  const xs = [1, 2, 3];
  console.log(total(xs), xs.length);
}
