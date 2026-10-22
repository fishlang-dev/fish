// expect: 7
interface Shape { area(): i64; }
interface Maker { make(): Shape; id(): i64; }
class Sq { area(): i64 { return 1; } }
class M { make(): Sq { return new Sq(); } id(): i64 { return 7; } }
function main() {
  const d: Dyn<Maker> = new M();
  console.log(d.id());
}
