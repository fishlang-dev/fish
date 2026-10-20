class Animal {
  legs = 4
}

class Dog extends Animal {}

function walk(a: Animal) {}

function main() {
  walk(new Dog())
}
// error: 'Dog' extends 'Animal' by embedding one, so it can't be used as 'Animal'; extract an interface both classes implement
