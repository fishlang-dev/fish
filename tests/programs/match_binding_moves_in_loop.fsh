type Box = { s: string };
function mk(n: i64): Box | null {
  return { s: "s" + n };
}
function take(b: Box): string { return b.s; }
function main() {
  for (let i = 0; i < 3; i++) {
    match (mk(i)) {
      case Some(b) => { console.log(take(b)); },
      case None => {},
    };
  }
}
// expect: s0
// expect: s1
// expect: s2
