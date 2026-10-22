// expect: built 3
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

class Named {
  name: string;
  tags: string[];
  constructor(name: string) {
    this.name = name;
    this.tags = [name + "!"];
  }
  area(): i64 {
    return 0;
  }
}

class Holder {
  shape: Dyn<Shape>;
  constructor(shape: Dyn<Shape>) {
    this.shape = shape;
  }
}

function make(big: boolean): Dyn<Shape> {
  if (big) return new Named("big" + "");
  return new Sq(3);
}

function main() {
  let shapes: Dyn<Shape>[] = [];
  shapes.push(new Sq(2));
  shapes.push(new Named("n" + ""));
  shapes.push(make(true));
  const one: Dyn<Shape> = new Named("one" + "");
  const h = new Holder(make(false));
  const moved = shapes.pop()!;
  const list: Dyn<Shape>[] = [new Sq(1), new Named("lit" + "")];
  console.log("built", shapes.length + 1);
}
