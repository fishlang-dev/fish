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
