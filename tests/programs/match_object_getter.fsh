interface HasN { n: i64; }
class G {
  k: i64;
  constructor(k: i64) { this.k = k; }
  get n(): i64 { return this.k * 10; }
}
function f(x: HasN): string {
  return match (x) { case { n: 10 } => "ten", case { n } => "n" + n };
}
function main() { console.log(f(new G(1)), f(new G(2))); }
// error: object patterns reading a field a getter provides are not supported yet
