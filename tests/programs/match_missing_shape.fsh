type Shape = { kind: "circle"; r: f64 } | { kind: "rect"; w: f64; h: f64 };

function area(s: Shape): f64 {
  return match (s) {
    case { kind: "circle", r } => r,
  };
}

function main() {
  console.log(area({ kind: "circle", r: 1.0 }));
}
// error: this match doesn't cover { kind: "rect" }; add 'case { kind: "rect" } =>'
