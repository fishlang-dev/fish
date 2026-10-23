// expect: 5 6 7 hi 42 9 circle 2 3 3
// The import and export forms: aliases, default exports of a function and of a value,
// `export { a as b }`, re-exports with `export { x } from` and `export *`, and an imported
// class, enum, interface and type alias.
import { add as plus, triple } from "./math";
import square from "./square";
import answer from "./answer";
import { Shape, Point, area, type Named, type Pair } from "./shapes";
import { inc, doubled } from "./all";
function describe(n: Named): string { return n.name; }
function main() {
  const p: Pair = { left: 2, right: 3 };
  const pt = new Point(1, 2);
  console.log(plus(2, 3), triple(2), inc(6), describe({ name: "hi" }), answer, square(3), area(Shape.Circle), pt.y, p.right, doubled(1) + 1);
}
