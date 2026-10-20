class Base {
  x = 1
}

class Derived extends Base {
  x = 2
}

function main() {}
// error: 'x' is already a field of 'Base'; with 'extends' as embedding it would be a second, separate field
