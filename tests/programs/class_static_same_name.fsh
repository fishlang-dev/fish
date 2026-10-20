class Unit {
  value(): i64 {
    return 1
  }

  static value(): i64 {
    return 2
  }
}

function main() {
  print(new Unit().value(), Unit.value())
}
// expect: 1 2
