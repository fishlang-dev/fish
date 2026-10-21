type Shape = { kind: "circle"; r: f64 } | { kind: "rect"; w: f64; h: f64 };

function main() {
  const s: Shape = { kind: "circle", r: 1.0 };
  const n = match (s) {
    case { radius } => 1,
    case _ => 0,
  };
  console.log(n);
}
// error: this pattern can never match
