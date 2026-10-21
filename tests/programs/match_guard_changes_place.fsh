type Box = { s: string; n: i64 };
function clear(b: Mut<Box | null>): boolean { b = null; return false; }
function main() {
  let x: Box | null = { s: "hello" + "1", n: 1 };
  const r = match (x) {
    case Some({ n }) if clear(x) => "cleared",
    case Some(b) => b.s,
    case None => "none",
  };
  console.log(r);
}
// error: cannot mutably lend 'x' while a match guard is reading 'x'
