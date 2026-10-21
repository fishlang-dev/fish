type Shape = { kind: "circle"; r: f64 } | { kind: "rect"; w: f64; h: f64 } | { kind: "label"; text: string };

class Point {
  x: i64;
  y: i64;
  constructor(x: i64, y: i64) {
    this.x = x;
    this.y = y;
  }
}

function area(s: Ref<Shape>): f64 {
  return match (s) {
    case { kind: "circle", r } => r * r * 3.0,
    case { kind: "rect", w, h } => w * h,
    case { kind: "label" } => 0.0,
  };
}

function name(s: Shape): string {
  return match (s) {
    case { kind: "label", text } => "label " + text,
    case { kind: "circle", r: 1.0 } => "unit circle",
    case _ => "other",
  };
}

function make(n: i64): Shape {
  if (n > 0) return { kind: "label", text: "made" + n };
  return { kind: "circle", r: 2.0 };
}

function where(p: Point): string {
  return match (p) {
    case { x: 0, y: 0 } => "origin",
    case { x: 0 } => "on y",
    case { y } if y > 5 => "high",
    case _ => "elsewhere",
  };
}

function sum(xs: i64[]): i64 {
  return match (xs) {
    case [] => 0,
    case [a] => a,
    case [a, b] => a + b,
    case [_, _, c] => c * 100,
    case _ => -1,
  };
}

function first(xs: Ref<string[]>): string {
  return match (xs) {
    case [a] => "one " + a,
    case [a, "x"] => "pair " + a,
    case _ => "many",
  };
}

function main() {
  const shapes: Shape[] = [{ kind: "circle", r: 1.0 }, { kind: "rect", w: 2.0, h: 3.0 }, { kind: "label", text: "hi" }];
  for (const s of shapes) console.log(area(s));
  const label: Shape = { kind: "label", text: "kept" };
  console.log(name({ kind: "label", text: "hi" }), name({ kind: "circle", r: 1.0 }), name({ kind: "rect", w: 1.0, h: 1.0 }));
  const kept = match (label) {
    case { kind: "label", text } => text,
    case _ => "none",
  };
  console.log(kept, area(label));
  const moved = match (make(3)) {
    case { kind: "label", text } => text,
    case _ => "none",
  };
  console.log(moved);
  console.log(where(new Point(0, 0)), where(new Point(0, 3)), where(new Point(1, 9)), where(new Point(1, 1)));
  console.log(sum([]), sum([4]), sum([4, 5]), sum([1, 2, 3]), sum([1, 2, 3, 4]));
  const words = ["a", "x"];
  console.log(first(["z"]), first(words), first(["q", "y"]), words.length);
  const taken = match (["p", "q"]) {
    case [a, b] => b + a,
    case _ => "",
  };
  console.log(taken);
}
// expect: 3
// expect: 6
// expect: 0
// expect: label hi unit circle other
// expect: kept 0
// expect: made3
// expect: origin on y high elsewhere
// expect: 0 4 9 300 -1
// expect: one z pair a many 2
// expect: qp
