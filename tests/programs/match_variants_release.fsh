enum Shape {
  Circle(f64),
  Rect(f64, f64),
  Label(string),
  Empty,
}

enum Result<T, E> {
  Ok(T),
  Err(E),
}

type P = { name: string };

function area(s: Ref<Shape>): f64 {
  return match (s) {
    case Circle(r) => r * r * 3.0,
    case Shape.Rect(w, h) => w * h,
    case Label(_) | Empty => 0.0,
  };
}

function describe(s: Shape): string {
  return match (s) {
    case Circle(r) if r > 10.0 => "big circle",
    case Circle(_) => "circle",
    case Label(text) => "label " + text,
    case Rect(w, 0.0) => "flat",
    case Rect(_, _) => "rect",
    case Empty => "empty",
  };
}

function parse(s: string): Result<i64, string> {
  if (s === "1") return Result.Ok(1);
  return Result.Err("bad " + s);
}

function make(n: i64): Shape {
  return n > 0 ? Shape.Label("made" + n) : Shape.Empty;
}

function main() {
  const shapes = [Shape.Circle(1.0), Shape.Rect(2.0, 3.0), Shape.Label("x" + 1), Shape.Empty, Shape.Circle(20.0), Shape.Rect(5.0, 0.0)];
  let total = 0.0;
  for (const s of shapes) total += area(s);
  console.log(total);
  for (const s of shapes) console.log(describe(s.clone()));
  const r = parse("1");
  const e = parse("q");
  const shown = match (e) {
    case Ok(n) => "ok " + n,
    case Err(msg) => msg,
  };
  console.log(shown, match (r) { case Ok(n) => n, case Err(_) => -1 });
  const o: string | null = "here" + 1;
  const n: i64 | null = null;
  console.log(match (o) { case Some(text) => text, case None => "none" }, match (n) { case None => "empty", case Some(v) => "has" });
  const nested: Result<Shape, string> = Result.Ok(Shape.Label("deep" + 1));
  console.log(match (nested) { case Ok(Label(t)) => t, case Ok(_) => "other", case Err(m) => m });
  const owned = match (make(3)) { case Label(t) => t, case _ => "" };
  console.log(owned, match (make(0)) { case Empty => "nothing", case _ => "?" });
  const people: P[] = [{ name: "ann" + 1 }];
  const maybe: P | null = { name: "bo" + 2 };
  console.log(match (maybe) { case Some(p) => p.name, case None => "" }, maybe !== null);
}
// mode: release
// expect: 1209
// expect: circle
// expect: rect
// expect: label x1
// expect: empty
// expect: big circle
// expect: flat
// expect: bad q 1
// expect: here1 empty
// expect: deep1
// expect: made3 nothing
// expect: bo2 true
