// error: an array can't hold the interface type 'Shape' directly, since its values may each be a different type
interface Shape {
  area(): i64;
}

class Sq {
  side: i64;
  constructor(side: i64) {
    this.side = side;
  }
  area(): i64 {
    return this.side * this.side;
  }
}

function main() {
  const xs: Shape[] = [new Sq(2)];
}
