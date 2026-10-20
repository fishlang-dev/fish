class Unit {
  value(n: i64): i64 {
    return n
  }
}

function make(): Unit {
  print("receiver")
  return new Unit()
}

function argument(): i64 {
  print("argument")
  return 1
}

function main() {
  print(make().value(argument()))
}
// expect: receiver
// expect: argument
// expect: 1
