// error: can't move a value out of a reference to it into a Dyn
interface Shape { area(): i64; }
class Named {
  name: string;
  constructor(name: string) { this.name = name; }
  area(): i64 { return this.name.length as i64; }
}
function f(r: Ref<Named>): i64 {
  const d: Dyn<Shape> = r;
  return d.area();
}
function main() {
  const n = new Named("place" + "");
  console.log(f(n));
}
