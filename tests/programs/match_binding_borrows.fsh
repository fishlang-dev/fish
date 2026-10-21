type P = { name: string };
enum Box {
  Has(P),
  No,
}

function touch(b: Mut<Box>): i64 {
  b = Box.No;
  return 1;
}

function main() {
  let b = Box.Has({ name: "n" + 1 });
  const x = match (b) {
    case Has(p) => touch(b) + (p.name.length as i64),
    case No => 0,
  };
}
// error: cannot mutably lend 'b' while 'p' borrows 'b' and is used later
