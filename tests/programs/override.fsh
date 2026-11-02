// case: override
// expect: 6 2 7
// expect: dog 4
// expect: 10 base
// A member written 'override' replaces its base's, a method, an accessor or an abstract member,
// and 'super' still reaches the base's.
class Base {
  n: i64
  constructor(n: i64) { this.n = n }
  get(k: i64): i64 { return k + this.n }
  get size(): i64 { return this.n }
  static make(): string { return "base" }
}

class Sub extends Base {
  constructor() { super(1) }
  override get(k: i64): i64 { return super.get(k) * 2 }
  override get size(): i64 { return this.n + 1 }
  static override make(): string { return "sub" }
}

abstract class Animal {
  abstract name(): string
  legs(): i64 { return 4 }
}

class Dog extends Animal {
  override name(): string { return "dog" }
}

class Deep extends Sub {
  override get(k: i64): i64 { return k * 10 }
}

function main() {
  const s = new Sub()
  console.log(s.get(2), s.size, s.get(2) + 1)
  const d = new Dog()
  console.log(d.name(), d.legs())
  console.log(new Deep().get(1), Base.make())
}
// case: override_no_base
class A {
  override n(): i64 { return 1 }
}

function main() {}
// error: 'n' can't be marked 'override': class 'A' doesn't extend another class
// case: override_missing
class Base {
  m(): i64 { return 1 }
}

class Sub extends Base {
  override n(): i64 { return 2 }
}

function main() {}
// error: 'n' can't be marked 'override': 'Base' has no member 'n' for it to replace
// case: override_static_missing
class Base {
  m(): i64 { return 1 }
}

class Sub extends Base {
  static override m(): i64 { return 2 }
}

function main() {}
// error: 'm' can't be marked 'override': 'Base' has no static member 'm' for it to replace
// case: override_field
class Base {
  n: i64 = 1
}

class Sub extends Base {
  override n: i64 = 2
}

function main() {}
// error: 'n' is already a field of 'Base'
// case: override_signature
class Base {
  m(k: i64): i64 { return k }
}

class P extends Base {
  override m(k: string): string { return k }
}

function main() {}
// error: 'm' overrides 'Base.m', so its parameter 'k' takes 'i64' as that one does, not 'string'
// case: override_extra_parameter
class Base {
  m(k: i64): i64 { return k }
}

class P extends Base {
  override m(k: i64, j: i64): i64 { return k + j }
}

function main() {}
// error: 'm' overrides 'Base.m', which takes 1 parameter, so its parameter 'j' must be optional
