type P = { name: string };
enum Box {
  Has(P),
  No,
}

function main() {
  let b = Box.Has({ name: "n" + 1 });
  const x = match (b) {
    case Has(p) => p.name.length,
    case No => 0,
  };
  b = Box.No;
  console.log(x);
}
// expect: 2
