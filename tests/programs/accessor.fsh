// case: accessor_const
class Circle {
  constructor(public r: i64) {}

  set radius(value: i64) {
    this.r = value
  }
}

function main() {
  const c = new Circle(1)
  c.radius = 4
}
// error: cannot assign to 'c.radius' because 'c' is a constant
// case: accessor_getter_writes
class Circle {
  constructor(public r: i64) {}

  get grown(): i64 {
    this.r++
    return this.r
  }
}

function main() {}
// error: cannot assign to 'this.r' because 'this' is read-only here; declare 'this: Mut<this>'
// case: accessor_readonly
class Circle {
  constructor(public r: i64) {}

  get diameter(): i64 {
    return this.r * 2
  }
}

function main() {
  let c = new Circle(1)
  c.diameter = 4
}
// error: cannot assign to 'diameter' because it is a read-only property
// case: accessor_setter_only
class Circle {
  constructor(public r: i64) {}

  set radius(value: i64) {
    this.r = value
  }
}

function main() {
  print(new Circle(1).radius)
}
// error: property 'radius' has a setter but no getter
