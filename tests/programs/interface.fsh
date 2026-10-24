// case: interface
function main() {
  interface Point { x: i64 }
}
// error: local interfaces are not supported yet
// error:   interface Point { x: i64 }
// error:   ^^^^^^^^^^^^^^^^^^^^^^^^^^
// case: interface_argument
interface Animal {
  speak(): i64
}

function describe(a: Animal): i64 {
  return a.speak()
}

function main() {
  describe({ legs: 4 })
}
// error: argument of type '{ legs: i64 }' is not assignable to parameter of type 'Animal': method 'speak' is missing in type '{ legs: i64 }' but required in type 'Animal'
// case: interface_array
// error: an array can't hold the interface type 'Shape' directly, since its values may each be a different type; use 'Dyn<Shape>[]' to hold any of them
interface Shape {
  area(): i64;
}

class Sq {
  side: i64;
  constructor(side: i64) {
    this.side = side;
  }
  area(): i64 {
    return this.side * this.side;
  }
}

function main() {
  const xs: Shape[] = [new Sq(2)];
}
// case: interface_builder
interface Builder {
  add(n: i64): Builder
  total(): i64
}

interface A {
  b(): B
}

interface B {
  a(): A
}

class Sum {
  constructor(public n: i64) {}

  add(n: i64): Sum {
    return new Sum(this.n + n)
  }

  total(): i64 {
    return this.n
  }
}

class Ping {
  b(): Pong {
    return new Pong()
  }
}

class Pong {
  a(): Ping {
    return new Ping()
  }
}

function finish(b: Builder): i64 {
  return b.add(2).add(3).total()
}

function bounce(x: A): i64 {
  return 1
}

function main() {
  print(finish(new Sum(1)), bounce(new Ping()))
}
// expect: 6 1
// case: interface_constructor
interface HasX {
  x: i64
}

class Pt {
  constructor(public y: i64, public x: i64) {}
}

class Flat {
  constructor(public x: i64) {}
}

class Holder {
  a: i64

  constructor(s: HasX) {
    this.a = s.x
  }
}

function main() {
  print(new Holder(new Pt(3, 4)).a, new Holder(new Flat(5)).a)
}
// expect: 4 5
// case: interface_double_dispatch
interface Visitor {
  visitLeaf(l: Leaf): i64
  visitPair(p: Pair): i64
}

interface Node {
  accept(v: Visitor): i64
}

class Leaf {
  constructor(public n: i64) {}

  accept(v: Visitor): i64 {
    return v.visitLeaf(this.clone())
  }
}

class Pair {
  constructor(public left: Leaf, public right: Leaf) {}

  accept(v: Visitor): i64 {
    return v.visitPair(this.clone())
  }
}

class Sum {
  visitLeaf(l: Leaf): i64 {
    return l.n
  }

  visitPair(p: Pair): i64 {
    return p.left.accept(this.clone()) + p.right.accept(this.clone())
  }
}

class Unused {
  accept(v: Visitor): i64 {
    return v.visitLeaf(new Leaf(0))
  }
}

function walk(n: Node): i64 {
  return n.accept(new Sum())
}

function main() {
  print(walk(new Leaf(3)), walk(new Pair(new Leaf(1), new Leaf(5))))
}
// expect: 3 6
// case: interface_duplicate
interface Named {
  name: i64
}

interface Labelled extends Named {
  name: boolean
}

function main() {}
// error: duplicate member 'name' in interface 'Labelled'
// case: interface_excess
interface Named {
  name: i64
}

function main() {
  const n: Named = { name: 1, extra: 2 }
}
// error: object literal may only specify known properties, and 'extra' does not exist in type 'Named'
// case: interface_extends_class
class Point {}

interface Shape extends Point {}

function main() {}
// error: an interface can only extend interfaces
// case: interface_field
interface Shape {
  area(): i64
}

class Holder {
  constructor(public shape: Shape) {}
}

function main() {}
// error: a field can't have the interface type 'Shape'; use a type parameter instead
// case: interface_generic_class
interface Put {
  put(v: i64): i64
}

class Box<T> {
  constructor(public value: T) {}

  put(v: T): i64 {
    return 1
  }
}

function use(p: Put): i64 {
  return p.put(2)
}

function main() {
  print(use(new Box<i64>(3)))
}
// expect: 1
// case: interface_missing
interface Shape {
  area(): i64
}

class Point implements Shape {
  constructor(public x: i64) {}
}

function main() {}
// error: class 'Point' incorrectly implements 'Shape': method 'area' is missing in type 'Point' but required in type 'Shape'
// case: interface_parameter_member
interface Animal {
  speak(): i64
}

function describe(a: Animal): i64 {
  return a.legs
}

function main() {}
// error: property 'legs' does not exist on type 'Animal'
// case: interface_parameters
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
// case: interface_private
interface Named {
  name: i64
}

class Secret {
  constructor(private name: i64) {}
}

function main() {
  const n: Named = new Secret(1)
}
// error: type 'Secret' is not assignable to type 'Named': property 'name' is missing in type 'Secret' but required in type 'Named'
// case: interface_return_two
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
// case: interface_return_unsatisfied
interface Animal {
  speak(): i64
}

function make(): Animal {
  return { legs: 4 }
}

function main() {}
// error: type '{ legs: i64 }' is not assignable to return type 'Animal': method 'speak' is missing in type '{ legs: i64 }' but required in type 'Animal'
// case: interface_returns_interface
interface Shape {
  area(): i64
}

interface Maker {
  make(): Shape
}

class Square {
  constructor(public side: i64) {}

  area(): i64 {
    return this.side * this.side
  }
}

class Factory implements Maker {
  make(): Shape {
    return new Square(3)
  }
}

function build<M extends Maker>(m: M): i64 {
  return m.make().area()
}

function main() {
  print(build(new Factory()))
}
// expect: 9
// case: interface_setter
interface HasX {
  x: i64
}

class Holder {
  a = 0

  set v(s: HasX) {
    this.a = s.x
  }
}

function main() {}
// error: a setter's parameter can't have the interface type 'HasX'
// case: interface_signature
interface Shape {
  scaled(by: i64): i64
}

class Square {
  scaled(by: boolean): i64 {
    return 1
  }
}

function main() {
  const s: Shape = new Square()
}
// error: type 'Square' is not assignable to type 'Shape': types of method 'scaled' are incompatible
// case: interface_top_level
interface Point { x: i64 }

function main() {
  const p: Point = { x: 1 }
  print(p.x)
}
// expect: 1
// case: interface_visitor
interface Shape {
  area(): i64
}

interface Visitor {
  visit(s: Shape): i64
}

class Square {
  constructor(public side: i64) {}

  area(): i64 {
    return this.side * this.side
  }
}

class Doubler implements Visitor {
  visit(s: Shape): i64 {
    return s.area() * 2
  }
}

function run(v: Visitor): i64 {
  return v.visit(new Square(3))
}

function main() {
  print(run(new Doubler()), new Doubler().visit(new Square(2)))
}
// expect: 18 8
