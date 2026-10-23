// expect: yes yes yes p
// A conditional type's extends, and Extract, meet an interface by shape, as in TypeScript.
interface Shape { area(): i64; }
interface Named { name: string; }
class Sq implements Shape { s: i64; constructor(s: i64) { this.s = s; } area(): i64 { return this.s * this.s; } }
class Person { name: string = "p"; }
type Is<T, U> = T extends U ? "yes" : "no";
type OnlyNamed = Extract<Person | Rock, Named>;
class Rock { weight: i64 = 1; }
function main() {
  const a: Is<Sq, Shape> = "yes";
  const b: Is<Person, Named> = "yes";
  const c: Is<{ name: string; age: i64 }, Named> = "yes";
  const p: OnlyNamed = new Person();
  console.log(a, b, c, p.name);
}
