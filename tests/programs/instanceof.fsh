// case: instanceof_derived
class Animal {}

class Dog extends Animal {}

function main() {
  const pet: Animal | Dog = new Dog()
  print(pet instanceof Animal, pet instanceof Dog)
}
// expect: false true
// case: instanceof_not_class
function main() {
  const x: i64 | boolean = 1
  print(x instanceof i64)
}
// error: the right side of 'instanceof' must be a class
