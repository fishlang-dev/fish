interface Shape {
  area(): i64
}

class Holder {
  constructor(public shape: Shape) {}
}

function main() {}
// error: a field can't have the interface type 'Shape'; use a type parameter instead
