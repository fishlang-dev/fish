interface Animal {
  legs: i64
  speak(): i64
}

class Dog {
  constructor(public legs: i64) {}

  speak(): i64 {
    return 1
  }
}

class Bird {
  legs = 2

  speak(): i64 {
    return this.legs * 10
  }
}

function describe(a: Animal): i64 {
  return a.speak() + a.legs * 100
}

function getX(p: { x: i64 }): i64 {
  return p.x
}

function loudest(a: Animal, b: Animal): i64 {
  return describe(a) + describe(b)
}

function pick(dog: boolean): Animal {
  return new Dog(dog ? 4 : 3)
}

function main() {
  print(describe(new Dog(4)), describe(new Bird()))
  print(loudest(new Dog(1), new Bird()))
  // Each shape gets its own instance, which reads x where that shape keeps it.
  const wide = { a: true, x: 2 }
  print(getX({ x: 1 }), getX(wide), getX(new Point3(3)))
  const a = pick(true)
  print(a.speak(), a.legs)
}

class Point3 {
  y = 0
  z = 0

  constructor(public x: i64) {}
}
// expect: 401 220
// expect: 321
// expect: 1 2 3
// expect: 1 4
