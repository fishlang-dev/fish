// error: keeps no record of its value's class, so 'instanceof' can't test it
interface Shape { area(): i64; }
class Sq { s: string; constructor(s: string) { this.s = s; } area(): i64 { return this.s.length as i64; } }
function main() { const a: Dyn<Shape> = new Sq("a" + ""); console.log(a instanceof Sq); }
