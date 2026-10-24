// expect: 1,1 10,20 0,1
// expect: a
// expect: 1
// expect: 2
// expect: 5,6
// A callback's parameter may widen what it is passed, a literal or an enum member to its base,
// or a value into a union, since each value is converted on the way in.
type K = "a" | "b";
type D = 1 | 2;
enum C { R, G }
function main() {
  const ks: K[] = ["a", "b"];
  const ds: D[] = [1, 2];
  console.log(ks.map((x: string) => x.length).join(), ds.map((x: i64) => x * 10).join(), [C.R, C.G].map((c: i64) => c).join());
  let zs: K[] = ["b", "a"];
  zs.sort((a: string, b: string) => a < b ? -1 : 1);
  console.log(zs[0]);
  [1, 2].forEach((x: i64 | null) => console.log(x ?? -1));
  console.log([4, 5].map((x: i64 | string) => typeof x === "string" ? 0 : x + 1).join());
}
