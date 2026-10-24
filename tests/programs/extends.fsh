// case: extends
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
// case: extends_cycle
class A extends B {}
class B extends A {}

function main() {}
// error: embeds itself through 'extends'
// case: extends_no_super
class Base {
  constructor(public x: i64) {}
}

class Derived extends Base {
  constructor() {
    print(1)
    super(1)
  }
}

function main() {}
// error: a derived class's constructor must start with 'super(...)'
// case: extends_not_base
class Animal {
  legs = 4
}

class Dog extends Animal {}

function walk(a: Animal) {}

function main() {
  walk(new Dog())
}
// error: 'Dog' extends 'Animal' by embedding one, so it can't be used as 'Animal'; extract an interface both classes implement
// case: extends_override
class Greeter {
  greet(): i64 {
    return this.name()
  }

  name(): i64 {
    return 1
  }
}

class Loud extends Greeter {
  name(): i64 {
    return 2
  }
}

function main() {}
// error: overriding 'name' is an error here: 'Greeter' reaches it through 'this', and with 'extends' as embedding that would still run 'Greeter.name'; extract an interface instead
// case: extends_protected
class Base {
  protected secret = 1
}

class Derived extends Base {
  reveal(): i64 {
    return this.secret
  }
}

function main() {
  print(new Derived().reveal())
  print(new Derived().secret)
}
// error: property 'secret' is protected and only accessible within class 'Base' and its subclasses
// case: extends_redeclare
class Base {
  x = 1
}

class Derived extends Base {
  x = 2
}

function main() {}
// error: 'x' is already a field of 'Base'; with 'extends' as embedding it would be a second, separate field
// case: extends_super_elsewhere
class Base {}

class Derived extends Base {
  again(this: Mut<this>) {
    super()
  }
}

function main() {}
// error: 'super(...)' can only be the first statement of a derived class's constructor
// case: extends_unknown
class Dog extends Animal {}

function main() {}
// error: cannot find class 'Animal'
