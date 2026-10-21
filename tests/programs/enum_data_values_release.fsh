enum Shape {
  Circle(f64),
  Rect(f64, f64),
  Label(string),
  Many(string[]),
  Empty,
}

type Box = { shape: Shape; note: string };

class Drawing {
  shapes: Shape[];
  constructor() {
    this.shapes = [];
  }
  add(this: Mut<this>, s: Shape) {
    this.shapes.push(s);
  }
}

function make(n: i64): Shape {
  if (n > 0) return Shape.Label("n" + n);
  return Shape.Empty;
}

function count(xs: Ref<Shape[]>): usize {
  return xs.length;
}

function main() {
  const a = Shape.Circle(1.5);
  let b: Shape = Shape.Rect(2.0, 3.0);
  b = make(4);
  const c = Shape.Many(["x" + 1, "y"]);
  const box: Box = { shape: Shape.Label("in" + 2), note: "n" + 3 };
  let d = new Drawing();
  d.add(Shape.Label("p" + 1));
  d.add(make(0));
  d.add(c);
  const copy = box.clone();
  const maybe: Shape | null = make(1);
  const list = [a, b, Shape.Empty];
  Shape.Label("dropped" + 1);
  console.log(count(d.shapes), count(list), copy.note, box.note, maybe === null);
}
// mode: release
// expect: 3 3 n3 n3 false
