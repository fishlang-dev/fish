type Box = { s: string; n: i64 };
function eat(b: Box | null): boolean { return false; }
function main() {
  let x: Box | null = { s: "hello" + "1", n: 1 };
  const r = match (x) {
    case Some({ n }) if eat(x) => "ate",
    case Some(b) => b.s,
    case None => "none",
  };
  console.log(r);
}
// error: cannot move 'x' while a match guard is reading 'x'
