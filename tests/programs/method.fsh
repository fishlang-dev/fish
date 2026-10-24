// case: method_as_value
class Counter {
  value(): i64 {
    return 1
  }
}

function main() {
  const f = new Counter().value
}
// error: methods can't be used as values yet; call it
// case: method_chain
class C {
  n = 1

  me(): C {
    return this.clone()
  }
}

function main() {
  const c = new C()
  print(c.me().me().me().me().me().me().me().me().me().me().me().me().me().me().me().me().me().me().me().me().me().me().me().me().me().me().n)
}
// expect: 1
// case: method_const_receiver
class Counter {
  count = 0

  bump(this: Mut<this>) {
    this.count++
  }
}

function main() {
  const c = new Counter()
  c.bump()
}
// error: cannot call 'bump' on 'c' because it is a constant
// case: method_parameter_receiver
class Counter {
  count = 0

  bump(this: Mut<this>) {
    this.count++
  }
}

function grow(c: Counter) {
  c.bump()
}

function main() {}
// error: calling a mutating method on a parameter is not supported yet; copy it into a 'let'
// case: method_readonly_call
class Counter {
  count = 0

  bump(this: Mut<this>) {
    this.count++
  }

  twice() {
    this.bump()
  }
}

function main() {}
// error: cannot call 'bump' on 'this' because 'this' is read-only here; declare 'this: Mut<this>'
// case: method_readonly_write
class Counter {
  count = 0

  bump() {
    this.count++
  }
}

function main() {}
// error: cannot assign to 'this.count' because 'this' is read-only here; declare 'this: Mut<this>'
// case: method_receiver_form
class Counter {
  close(this: Box<this>) {}
}

function main() {}
// error: receivers other than 'this: Ref<this>', 'this: Mut<this>' and 'this: Own<this>' are not supported yet
// case: method_static_unknown
class Counter {}

function main() {
  Counter.make()
}
// error: property 'make' does not exist on type 'typeof Counter'
// case: method_unknown
class Counter {}

function main() {
  new Counter().bump()
}
// error: 'Counter' has no method 'bump'
