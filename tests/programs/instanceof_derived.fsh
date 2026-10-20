class Animal {}

class Dog extends Animal {}

function main() {
  const pet: Animal | Dog = new Dog()
  print(pet instanceof Animal, pet instanceof Dog)
}
// expect: false true
