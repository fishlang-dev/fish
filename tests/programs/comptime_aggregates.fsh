// expect: 3 e2 20 1
// expect: 1 25 5
// expect: true
// expect: 7 here
// expect: 6.75 6 0
// expect: 10 -1
// expect: 12.75
// expect: 3 e2 20 1
// expect: 1 25 5
// expect: true
// expect: 7 here
// expect: 6.75 6 0
// expect: 10 -1
// expect: 12.75
// Arrays, objects, instances, enums and Options computed while compiling, baked, and read at
// run time, alongside the same code run at run time.
enum Color { Red, Green, Blue }
enum Shape { Circle(f64), Rect(f64, f64), Dot }
type Entry = { name: string; code: i64; tags: string[] };
class Point {
  x: i64;
  y: i64;
  constructor(x: i64, y: i64) { this.x = x; this.y = y; }
  sum(): i64 { return this.x + this.y; }
}
class Labeled extends Point {
  label: string;
  constructor(x: i64, y: i64, label: string) { super(x, y); this.label = label; }
}
function table(): Entry[] {
  let out: Entry[] = [];
  for (let i = 0; i < 3; i++) out.push({ name: "e" + String(i), code: i * 10, tags: ["t", String(i)] });
  return out;
}
function squares(n: i64): i64[] {
  let out: i64[] = [];
  for (let i = 1; i <= n; i++) out.push(i * i);
  return out;
}
function pick(n: i64): Color {
  if (n === 0) return Color.Red;
  return n === 1 ? Color.Green : Color.Blue;
}
function shapes(): Shape[] {
  return [Shape.Circle(1.5), Shape.Rect(2, 3), Shape.Dot];
}
function area(s: Ref<Shape>): f64 {
  return match (s) {
    case Shape.Circle(r) => r * r * 3,
    case Shape.Rect(w, h) => w * h,
    case Shape.Dot => 0,
  };
}
function find(name: string): Entry | null {
  for (const e of table()) {
    if (e.name === name) return e.clone();
  }
  return null;
}
function total(): f64 {
  let t: f64 = 0;
  for (const s of shapes()) t += area(s);
  return t;
}
function main() {
  const t = comptime table();
  console.log(t.length, t[2].name, t[2].code, t[1].tags[1]);
  const sq = comptime squares(5);
  console.log(sq[0], sq[4], sq.length);
  const c = comptime pick(2);
  console.log(c === Color.Blue);
  const p = comptime new Labeled(3, 4, "here");
  console.log(p.sum(), p.label);
  const ss = comptime shapes();
  console.log(area(ss[0]), area(ss[1]), area(ss[2]));
  const f = comptime find("e1");
  const g = comptime find("zz");
  console.log(f?.code ?? -1, g?.code ?? -1);
  console.log(comptime total());
  // The same, at run time.
  const t2 = table();
  console.log(t2.length, t2[2].name, t2[2].code, t2[1].tags[1]);
  const sq2 = squares(5);
  console.log(sq2[0], sq2[4], sq2.length);
  console.log(pick(2) === Color.Blue);
  const p2 = new Labeled(3, 4, "here");
  console.log(p2.sum(), p2.label);
  const ss2 = shapes();
  console.log(area(ss2[0]), area(ss2[1]), area(ss2[2]));
  const f2 = find("e1");
  const g2 = find("zz");
  console.log(f2?.code ?? -1, g2?.code ?? -1);
  console.log(total());
}
