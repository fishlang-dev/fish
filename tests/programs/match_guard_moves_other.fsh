type Box = { s: string };

function take(b: Box): boolean {
  return b.s === "no";
}

function main() {
  const n = 2;
  const y: Box = { s: "a" + "b" };
  const r = match (n) {
    case 1 if take(y) => "taken",
    case _ => y.s,
  };
  console.log(r);
}
// error: 'y.s' can't be used here because 'y' was moved
