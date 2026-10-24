// expect: 1
// filter over Options of Dyns gives copies, as over Dyns.
interface Shape { area(): i64; }
class Sq { s: i64; constructor(s: i64) { this.s = s; } area(): i64 { return this.s * this.s; } }
function main() {
  const d: Dyn<Shape> = new Sq(3);
  const ds: (Dyn<Shape> | null)[] = [d, null];
  console.log(ds.filter((x) => x !== null).length);
}
