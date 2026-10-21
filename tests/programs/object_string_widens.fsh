type K = "a" | "b";
type O = { k: K; n: i64 };

function main() {
  let o = { name: "x", n: 1 };
  o.name = "y" + 1;
  const typed: O = { k: "b", n: 2 };
  console.log(o.name, typed.k);
}
// expect: y1 b
