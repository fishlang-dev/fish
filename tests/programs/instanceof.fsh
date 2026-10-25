// case: instanceof_derived
class Animal {}

class Dog extends Animal {}

function main() {
  const pet: Animal | Dog = new Dog()
  print(pet instanceof Animal, pet instanceof Dog)
}
// expect: true true
// case: instanceof_not_class
function main() {
  const x: i64 | boolean = 1
  print(x instanceof i64)
}
// error: the right side of 'instanceof' must be a class
// case: instanceof_derived_comptime
class Animal { name: string; constructor(n: string) { this.name = n; } }
class Dog extends Animal { constructor(n: string) { super(n); } }
function test(): boolean { const d = new Dog("c"); return d instanceof Animal; }
function main() {
  const a = comptime test();
  console.log(a, test());
}
// expect: true true
