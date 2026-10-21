type K = "a" | "b";
type O = { k: K; n: i64 };
type T = { tag: "t"; name: string };
type U = { tag: "t" | "u"; name: string };

function main() {
  let o = { name: "x", n: 1 };
  o.name = "y" + 1;
  const typed: O = { k: "b", n: 2 };
  const t: T = { tag: "t", name: "x" };
  const u: U = { tag: "u", name: "z" + 1 };
  console.log(o.name, typed.k, t.tag, t.name, u.tag, u.name);
}
// expect: y1 b t x u z1
