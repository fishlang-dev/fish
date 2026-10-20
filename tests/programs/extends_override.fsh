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
