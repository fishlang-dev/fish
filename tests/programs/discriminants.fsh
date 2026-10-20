type Circle = { kind: "circle"; r: i64 }
type Square = { kind: "square"; side: i64 }
type Shape = Circle | Square

class Dog {
  constructor(public name: i64) {}

  bark(): i64 {
    return this.name * 10
  }
}

class Cat {
  lives = 9
}

function area(s: Shape): i64 {
  if (s.kind === "circle") return 3 * s.r * s.r
  return s.side * s.side
}

function describe(s: Shape): i64 {
  switch (s.kind) {
    case "circle":
      return s.r
    case "square":
      return s.side * 100
  }
  return 0
}

function sound(pet: Dog | Cat): i64 {
  if (pet instanceof Dog) return pet.bark()
  return pet.lives
}

function classify(d: "a" | "b" | "c" | i64): i64 {
  switch (d) {
    case "a":
    case "b":
      return 1
    case 7:
      return 7
    case "c":
      return 3
    default:
      return 0
  }
}

function main() {
  const c: Shape = { kind: "circle", r: 2 }
  const q: Shape = { kind: "square", side: 3 }
  print(area(c), area(q), c.kind, q.kind)
  print(describe(c), describe(q))
  print(sound(new Dog(4)), sound(new Cat()))
  const pet: Dog | Cat = new Cat()
  print(pet instanceof Dog, pet instanceof Cat)
  print(classify("a"), classify("b"), classify("c"), classify(7), classify(8))
  // A field written through a narrowed variable changes the union's member in place.
  let held: Dog | Cat = new Dog(1)
  if (held instanceof Dog) {
    held.name = 5
  }
  print(sound(held))
}
// expect: 12 9 circle square
// expect: 2 300
// expect: 40 9
// expect: false true
// expect: 1 1 3 7 0
// expect: 50
