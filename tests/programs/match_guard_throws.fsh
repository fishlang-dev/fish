class Oops {
  why: string;
  constructor(why: string) { this.why = why; }
}
type Box = { s: string; n: i64 };
function risky(n: i64): boolean throws Oops {
  if (n > 0) throw new Oops("boom");
  return false;
}
function main() {
  let x: Box | null = { s: "a" + "b", n: 1 };
  try {
    const r = match (x) {
      case Some({ n }) if risky(n) => "risky",
      case _ => "other",
    };
    console.log(r);
  } catch (e) {
    x = null;
    console.log("caught " + e.why);
  }
  console.log(x === null);
}
// expect: caught boom
// expect: true
