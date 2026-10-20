interface Animal {
  legs: i64
}

class Dog {
  legs = 4
}

class Bird {
  legs = 2
}

function pick(dog: boolean): Animal {
  if (dog) return new Dog()
  return new Bird()
}

function main() {}
// error: type 'Bird' is not assignable to return type 'Dog'
