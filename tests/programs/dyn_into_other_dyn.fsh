// error: a 'Dyn<Shape>' can't become a 'Dyn<Empty>' yet
interface Empty {}
interface Shape { area(): i64; }
class Sq { s: string; constructor(s: string) { this.s = s; } area(): i64 { return this.s.length as i64; } }
function main() {
  const s: Dyn<Shape> = new Sq("abc" + "");
  const g: Dyn<Empty> = s;
  const h = g.clone();
  console.log(1);
}
