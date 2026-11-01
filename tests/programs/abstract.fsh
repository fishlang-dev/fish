// case: abstract
// expect: circle has area 12
// expect: square has area 9
// expect: SQUARE HAS AREA 2.25
// expect: circle
// A base method calling an abstract member runs each subclass's own implementation, directly or
// through another base method.
abstract class Shape {
  #label: string
  constructor(label: string) { this.#label = label }
  abstract area(): f64
  describe(): string { return `${this.#label} has area ${this.area()}` }
  loud(): string { return this.describe().toUpperCase() }
  label(): string { return this.#label }
}

class Circle extends Shape {
  constructor(public r: f64) { super("circle") }
  area(): f64 { return 3.0 * this.r * this.r }
}

class Square extends Shape {
  constructor(public side: f64) { super("square") }
  area(): f64 { return this.side * this.side }
}

function main() {
  print(new Circle(2.0).describe())
  print(new Square(3.0).describe())
  print(new Square(1.5).loud())
  print(new Circle(1.0).label())
}
// case: abstract_getter
// expect: 4 sides
// expect: 0 sides
// expect: 5 sides
// An abstract getter, implemented by a getter or by a field.
abstract class Shape {
  protected abstract get sides(): i64
  count(): string { return `${this.sides} sides` }
}

class Square extends Shape {
  protected get sides(): i64 { return 4 }
}

class Circle extends Shape {
  get sides(): i64 { return 0 }
}

class Star extends Shape {
  sides = 5
}

function main() {
  print(new Square().count())
  print(new Circle().count())
  print(new Star().count())
}
// case: abstract_chain
// expect: triangle: 3 corners, area 0.5
// expect: quad: 4 corners, area 2
// An abstract class extending another leaves its abstract members to the first concrete class.
abstract class Shape {
  abstract area(): f64
  abstract name(): string
  describe(): string { return `${this.name()}: ${this.corners()} corners, area ${this.area()}` }
  abstract corners(): i64
}

abstract class Polygon extends Shape {
  abstract sides(): i64
  corners(): i64 { return this.sides() }
}

class Triangle extends Polygon {
  area(): f64 { return 0.5 }
  name(): string { return "triangle" }
  sides(): i64 { return 3 }
}

class Quad extends Polygon {
  constructor(public w: f64) { super() }
  area(): f64 { return this.w * 2.0 }
  name(): string { return "quad" }
  sides(): i64 { return 4 }
}

function main() {
  print(new Triangle().describe())
  print(new Quad(1.0).describe())
}
// case: abstract_new
abstract class Shape {
  abstract area(): f64
}

function main() {
  const s = new Shape()
}
// error: 6:13: error[E0701]: cannot create an instance of the abstract class 'Shape'
// case: abstract_missing
abstract class Shape {
  abstract area(): f64
  abstract get name(): string
}

abstract class Polygon extends Shape {
  abstract sides(): i64
}

class Triangle extends Polygon {
  sides(): i64 { return 3 }
}

function main() {}
// error: 10:1: error[E0701]: class 'Triangle' must implement the abstract method 'area' of 'Shape', getter 'name' of 'Shape'
// case: abstract_outside_abstract_class
class Shape {
  abstract area(): f64
}

function main() {}
// error: 2:3: error[E0701]: abstract members can only appear in an abstract class
// case: abstract_private
abstract class Shape {
  private abstract area(): f64
}

function main() {}
// error: 2:3: error[E0701]: an abstract member can't be private, since subclasses must implement it
// case: abstract_hash
abstract class Shape {
  abstract #area(): f64
}

function main() {}
// error: 2:3: error[E0701]: an abstract member can't be private, since subclasses must implement it
// case: abstract_static
abstract class Shape {
  static abstract make(): i64
}

function main() {}
// error: 2:3: error[E0701]: 'static' can't be used with 'abstract'
// case: abstract_body
abstract class Shape {
  abstract area(): f64 { return 0.0 }
}

function main() {}
// error: 2:3: error[E0701]: 'area' can't have a body because it is marked abstract
// case: abstract_narrower_access
abstract class Shape {
  abstract area(): f64
}

class Circle extends Shape {
  protected area(): f64 { return 1.0 }
}

function main() {}
// error: 6:3: error[E0701]: 'area' implements a public abstract member of 'Shape', so it must be public
// case: abstract_as_local_type
abstract class Shape {}

class Circle extends Shape {}

function main() {
  const s: Shape = new Circle()
}
// error: 6:12: error[E0701]: 'Shape' is an abstract class, which only exists embedded in its subclasses, so it can't be a value's type; describe what they share with an interface instead
// case: abstract_as_parameter_type
abstract class Shape {}

function area(s: Shape): f64 { return 0.0 }

function main() {}
// error: 3:18: error[E0701]: 'Shape' is an abstract class
// case: abstract_as_field_type
abstract class Shape {}

class Holder {
  constructor(public shape: Shape) {}
}

function main() {}
// error: 4:29: error[E0701]: 'Shape' is an abstract class
// case: abstract_field
abstract class Shape {
  abstract sides: i64
}

function main() {}
// error: 2:3: error[E0801]: abstract fields are not supported yet
// case: abstract_override_template
// expect: 70 20
// A subclass overriding a base method that calls an abstract member is reached through the
// base's other methods too.
abstract class Shape {
  abstract sides(): i64
  corners(): i64 { return this.sides() }
  scaled(): i64 { return this.corners() * 10 }
}

class Odd extends Shape {
  sides(): i64 { return 1 }
  corners(): i64 { return 7 }
}

class Line extends Shape {
  sides(): i64 { return 2 }
}

function main() {
  print(new Odd().scaled(), new Line().scaled())
}
// case: abstract_mutable
// expect: 6
abstract class Counter {
  n = 0
  abstract bump(this: Mut<this>): void
  twice(this: Mut<this>) { this.bump(); this.bump() }
}

class ByThree extends Counter {
  bump(this: Mut<this>) { this.n += 3 }
}

function main() {
  let c = new ByThree()
  c.twice()
  print(c.n)
}
// case: abstract_generic
abstract class Source<T> {
  abstract next(): T
}

function main() {}
// error: 1:1: error[E0801]: generic abstract classes are not supported yet
// case: abstract_generic_subclass
// expect: area 9 x
// expect: area 4 2
// A generic class's instances each get their own copy of the abstract base's template.
abstract class Shape {
  abstract area(): i64
  describe(): string { return `area ${this.area()}` }
}

class Square<T> extends Shape {
  constructor(public side: i64, public tag: T) { super() }
  area(): i64 { return this.side * this.side }
}

function main() {
  const a = new Square<string>(3, "x")
  const b = new Square<i64>(2, 2)
  print(`${a.describe()} ${a.tag}`)
  print(`${b.describe()} ${b.tag}`)
}
// case: abstract_generic_subclass_missing
abstract class Shape {
  abstract area(): i64
}

class Square<T> extends Shape {
  constructor(public tag: T) { super() }
}

function main() {}
// error: 5:1: error[E0701]: class 'Square<T>' must implement the abstract method 'area' of 'Shape'
// case: abstract_implements_interface
// expect: 2
// expect: area 2
// expect: area 2
// expect: area 3
// An abstract member counts toward an interface the abstract class implements, and each
// subclass satisfies it through its implementations.
interface HasArea { area(): f64 }
interface Describes { describe(): string }

abstract class Shape implements HasArea, Describes {
  abstract area(): f64
  describe(): string { return `area ${this.area()}` }
}

class Small extends Shape { area(): f64 { return 2.0 } }
class Large extends Shape { area(): f64 { return 3.0 } }

function one(s: Ref<Describes>) { print(s.describe()) }
function all(xs: Dyn<Describes>[]) { for (const x of xs) print(x.describe()) }

function main() {
  print(new Small().area())
  one(new Small())
  all([new Small(), new Large()])
}
// case: abstract_signature_fewer_params
abstract class Shape {
  abstract area(scale: i64): f64
}

class Square extends Shape {
  area(): f64 { return 1.0 }
}

function main() {}
// error: 6:3: error[E0701]: 'area' must take (i64), as 'Shape' declares it abstract
// case: abstract_signature_other_params
abstract class Shape {
  abstract area(scale: i64): f64
}

class Square extends Shape {
  area(scale: string, by: i64): f64 { return 1.0 }
}

function main() {}
// error: 6:3: error[E0701]: 'area' must take (i64), as 'Shape' declares it abstract
// case: abstract_signature_return
abstract class Shape {
  abstract area(): f64
  double(): f64 { return this.area() * 2.0 }
}

class Square extends Shape {
  area(): string { return "one" }
}

function main() {
  print(new Square().double())
}
// error: 7:3: error[E0701]: 'area' must return 'number', not 'string', as 'Shape' declares it abstract
// case: abstract_signature_receiver
abstract class Counter {
  n = 0
  abstract bump(): void
}

class ByOne extends Counter {
  bump(this: Mut<this>) { this.n += 1 }
}

function main() {}
// error: 7:3: error[E0701]: 'bump' can't change 'this'; it borrows 'this' read-only, as 'Counter' declares it abstract
// case: abstract_signature_field
abstract class Shape {
  abstract get sides(): i64
}

class Named extends Shape {
  sides: string = "four"
}

function main() {}
// error: 6:3: error[E0701]: 'sides' must be a 'i64', not a 'string', as 'Shape' declares it abstract
// case: abstract_template_unused
// A member reaching an abstract member is checked even when nothing calls it.
abstract class Shape {
  abstract area(): f64
  label(): string {
    const s: string = this.area()
    return s
  }
}

class Square extends Shape {
  area(): f64 { return 1.0 }
}

function main() {
  print(new Square().area())
}
// error: 5:23: error[E0101]: type 'number' is not assignable to type 'string'
// case: abstract_template_no_subclass
abstract class Counter {
  abstract bump(this: Mut<this>): void
  twice() { this.bump(); this.bump() }
}

function main() {}
// error: 3:13: error[E0206]: cannot call 'bump' on 'this' because 'this' is read-only here; declare 'this: Mut<this>'
// case: abstract_constructor_reaches
abstract class Shape {
  size: f64
  constructor() { this.size = this.area() }
  abstract area(): f64
}

class Square extends Shape {
  constructor() { super() }
  area(): f64 { return 1.0 }
}

function main() {}
// error: 3:3: error[E0701]: 'Shape' can't reach its abstract member 'area' while it is being constructed
// case: abstract_override_through_template
// A concrete base calling a template runs its own copy, so a subclass can't override what the
// template reaches.
abstract class Shape {
  abstract sides(): i64
  count(): i64 { return this.sides() }
}

class Square extends Shape {
  sides(): i64 { return 4 }
  doubled(): i64 { return this.count() * 2 }
}

class Odd extends Square {
  sides(): i64 { return 5 }
}

function main() {}
// error: 14:3: error[E0704]: overriding 'sides' is an error here: 'Square' calls 'this.count', which reaches 'sides', and with 'extends' as embedding the copy of 'count' in 'Square' would still run 'Square.sides'
// case: abstract_super_in_template
// expect: 5
// A base method reaching an abstract member may still call its own base through 'super'.
class Base {
  id(): i64 { return 1 }
}

abstract class Shape extends Base {
  abstract sides(): i64
  total(): i64 { return this.sides() + super.id() }
}

class Square extends Shape {
  sides(): i64 { return 4 }
}

function main() {
  print(new Square().total())
}
// case: abstract_this_escapes
// expect: 2
// expect: 2
// expect: 3
// A base method handing 'this' on reaches each subclass's implementation through it.
interface HasArea { area(): f64 }

function viaInterface(h: Ref<HasArea>): f64 { return h.area() }
function viaGeneric<T extends HasArea>(h: Ref<T>): f64 { return h.area() }

abstract class Shape implements HasArea {
  abstract area(): f64
  first(): f64 { return viaInterface(this) }
  second(): f64 { return viaGeneric(this) }
}

class Small extends Shape { area(): f64 { return 2.0 } }
class Large extends Shape { area(): f64 { return 3.0 } }

function main() {
  print(new Small().first())
  print(new Small().second())
  print(new Large().second())
}
// case: abstract_constructor_escapes
interface HasArea { area(): f64 }

function viaInterface(h: Ref<HasArea>): f64 { return h.area() }

abstract class Shape implements HasArea {
  constructor() { print(viaInterface(this)) }
  abstract area(): f64
}

class Square extends Shape {
  constructor() { super() }
  area(): f64 { return 1.0 }
}

function main() {}
// error: 6:3: error[E0701]: 'Shape' is abstract, so its constructor can't hand 'this' on as a value
// case: abstract_super_abstract
abstract class Shape {
  abstract area(): f64
}

class Square extends Shape {
  area(): f64 { return super.area() + 1.0 }
}

function main() {}
// error: 6:24: error[E0701]: 'area' is abstract in 'Shape', so 'super.area()' has nothing to run
// case: abstract_super_template
// expect: 2
// expect: 2
// expect: 2 9
// 'super.g()' runs the calling class's copy of a base method, beside its own 'g' too.
abstract class Base {
  abstract f(): i64
  g(): i64 { return this.f() + 1 }
}

class Plain extends Base {
  f(): i64 { return 1 }
  h(): i64 { return super.g() }
}

abstract class Middle extends Base {
  k(): i64 { return super.g() }
}

class Last extends Middle {
  f(): i64 { return 1 }
}

class Own extends Base {
  f(): i64 { return 1 }
  g(): i64 { return 9 }
  both(): string { return `${super.g()} ${this.g()}` }
}

function main() {
  print(new Plain().h())
  print(new Last().k())
  print(new Own().both())
}
// case: abstract_declared_result
// expect: 7
// expect: none
// expect: 4
// A base method sees an abstract member's result and errors as declared, whatever narrower
// ones an implementation gives.
abstract class Source {
  abstract next(): i64 | null
  abstract risky(): i64 throws string
  show(): string {
    const v = this.next()
    return v === null ? "none" : `${v}`
  }
  safe(): i64 {
    try { return this.risky() } catch (e) { return 0 }
  }
}

class Seven extends Source {
  next(): i64 { return 7 }
  risky(): i64 { return 4 }
}

class Empty extends Source {
  next(): null { return null }
  risky(): i64 { return 4 }
}

function main() {
  print(new Seven().show())
  print(new Empty().show())
  print(new Seven().safe())
}
// case: abstract_signature_wider_forms
// expect: 1
// expect: x
// An implementation may add optional parameters, or be generic over what the declaration takes.
abstract class Scale {
  abstract by(x: i64): i64
  once(): i64 { return this.by(1) }
}

class Plain extends Scale {
  by(x: i64, extra?: i64): i64 { return x }
}

abstract class Echo {
  abstract say(s: string): string
  run(): string { return this.say("x") }
}

class Same extends Echo {
  say<T>(s: T): T { return s }
}

function main() {
  print(new Plain().once())
  print(new Same().run())
}
// case: abstract_signature_rest
abstract class Scale {
  abstract by(x: i64): i64
}

class Many extends Scale {
  by(...xs: i64[]): i64 { return xs.length }
}

function main() {}
// error: 6:6: error[E0801]: 'by' can't gather its arguments into a rest parameter yet where 'Scale' declares it abstract with separate ones
// case: abstract_without_abstract_members_this_escapes
// expect: 5
// expect: 5
// An abstract class with no abstract members still hands 'this' on as each subclass.
interface HasArea { area(): f64 }

function viaInterface(h: Ref<HasArea>): f64 { return h.area() }
function viaGeneric<T extends HasArea>(h: Ref<T>): f64 { return h.area() }

abstract class Shape implements HasArea {
  area(): f64 { return 5.0 }
  first(): f64 { return viaInterface(this) }
  second(): f64 { return viaGeneric(this) }
}

class Square extends Shape {}

function main() {
  print(new Square().first())
  print(new Square().second())
}
// case: abstract_without_abstract_members_constructor_escapes
interface HasArea { area(): f64 }

function viaInterface(h: Ref<HasArea>): f64 { return h.area() }

abstract class Shape implements HasArea {
  size: f64
  constructor() { this.size = 0.0; print(viaInterface(this)) }
  area(): f64 { return 5.0 }
}

class Square extends Shape {
  constructor() { super() }
}

function main() {}
// error: 7:3: error[E0701]: 'Shape' is abstract, so its constructor can't hand 'this' on as a value: the subclass being built isn't finished yet
// case: abstract_clone_to_generic
interface Counts { count(): i64 }

function total<T extends Counts>(x: T): i64 { return x.count() }

abstract class Tally {
  n = 1
  count(): i64 { return this.n }
  sum(): i64 { return total(this.clone()) }
}

class Daily extends Tally {}

function main() {
  print(new Daily().sum())
}
// error: 8:29: error[E0701]: this would make a value of the abstract class 'Tally', which only exists embedded in its subclasses; give this method to each subclass, or clone the subclass's value there
// case: abstract_clone_in_constructor
interface Counts { count(): i64 }

function total<T extends Counts>(x: T): i64 { return x.count() }

abstract class Tally {
  n = 1
  count(): i64 { return this.n }
  constructor() { print(total(this.clone())) }
}

class Daily extends Tally {
  constructor() { super() }
}

function main() {
  print(new Daily().count())
}
// error: 8:31: error[E0701]: this would make a value of the abstract class 'Tally', which only exists embedded in its subclasses; give this method to each subclass, or clone the subclass's value there
// case: abstract_clone_to_dyn
// A copy of 'this' would be a value of the abstract class, whose table for a Dyn would hold an
// abstract member with no code.
interface Quantity { q(): i64 }

abstract class Tally {
  abstract q(): i64
  boxed(): i64 {
    const d: Dyn<Quantity> = this.clone()
    return d.q()
  }
}

class Daily extends Tally {
  q(): i64 { return 7 }
}

function main() {
  print(new Daily().boxed())
}
// error: 8:30: error[E0701]: this would make a value of the abstract class 'Tally', which only exists embedded in its subclasses; give this method to each subclass, or clone the subclass's value there
// case: abstract_clone_to_generic_class
interface Counts { count(): i64 }

class Holder<T extends Counts> {
  v: T
  constructor(v: T) { this.v = v }
  get(): i64 { return this.v.count() }
}

abstract class Tally {
  n = 1
  count(): i64 { return this.n }
  held(): i64 {
    const h = new Holder(this.clone())
    return h.get()
  }
}

class Daily extends Tally {}

function main() {
  print(new Daily().held())
}
// error: 13:26: error[E0701]: this would make a value of the abstract class 'Tally', which only exists embedded in its subclasses; give this method to each subclass, or clone the subclass's value there
// case: abstract_clone_in_closure
interface Counts { count(): i64 }

function total<T extends Counts>(x: Ref<T>): i64 { return x.count() }

abstract class Tally {
  n = 1
  count(): i64 { return this.n }
  later(): () => i64 {
    const c = this.clone()
    return () => total(c)
  }
}

class Daily extends Tally {}

function main() {
  const g = new Daily().later()
  print(g())
}
// error: 9:15: error[E0701]: this would make a value of the abstract class 'Tally', which only exists embedded in its subclasses; give this method to each subclass, or clone the subclass's value there
// case: abstract_clone_compared
class Base {
  n: i64 = 1
}

abstract class Tally extends Base {
  abstract k(): i64
  equals(other: Ref<Base>): boolean { return this.k() === other.n }
  same(): boolean { return this.clone() === this.clone() }
}

class Daily extends Tally {
  k(): i64 { return 1 }
}

function main() {
  print(new Daily().same())
}
// error: 8:28: error[E0701]: this would make a value of the abstract class 'Tally', which only exists embedded in its subclasses; give this method to each subclass, or clone the subclass's value there
