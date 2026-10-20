type Named = { id: i64 }

class Animal {
  legs: i64
  protected sound = 1

  constructor(public id: i64, legs: i64) {
    this.legs = legs
  }

  describe(): i64 {
    return this.id * 100 + this.legs
  }

  grow(this: Mut<this>) {
    this.legs++
  }

  get noise(): i64 {
    return this.sound
  }

  static kind(): i64 {
    return 42
  }
}

class Dog extends Animal {
  tricks = 0

  constructor(id: i64, public good: boolean) {
    super(id, 4)
    this.sound = 2
  }

  learn(this: Mut<this>) {
    this.tricks++
    super.grow()
  }

  describe(): i64 {
    return super.describe() + this.tricks * 10
  }
}

class Puppy extends Dog {
  wag(): i64 {
    return this.noise + this.legs
  }
}

class Point {
  constructor(public x: i64) {}

  sum(): i64 {
    return this.x
  }
}

class Point3 extends Point {
  z = 0

  sum(): i64 {
    return super.sum() + this.z
  }
}

function idOf(n: Named): i64 {
  return n.id
}

function main() {
  let d = new Dog(3, true)
  print(d.id, d.legs, d.good, d.noise)
  d.learn()
  d.grow()
  print(d.describe(), d.legs, d.tricks)
  print(Dog.kind(), idOf(d))
  let p = new Puppy(5, false)
  p.learn()
  print(p.wag(), p.describe(), p.good)
  // A literal builds the embedded base too.
  const q: Point3 = { x: 1, z: 2 }
  print(q.sum(), new Point3(7).sum())
}
// expect: 3 4 true 2
// expect: 316 6 1
// expect: 42 3
// expect: 7 515 false
// expect: 3 7
