// expect: 4 9 0 13
// expect: sq n n!
// expect: 5 6
// expect: closed main shutting
interface Shape {
  label: string;
  area(): i64;
  grow(this: Mut<this>, by: i64): void;
}

class Base {
  label: string;
  constructor(label: string) {
    this.label = label;
  }
  area(): i64 {
    return 0;
  }
}

class Sq {
  side: i64;
  label: string = "sq";
  constructor(side: i64) {
    this.side = side;
  }
  area(): i64 {
    return this.side * this.side;
  }
  grow(this: Mut<this>, by: i64) {
    this.side += by;
  }
}

class Named extends Base {
  tags: string[];
  constructor(name: string) {
    super(name);
    this.tags = [name + "!"];
  }
  grow(this: Mut<this>, by: i64) {
    this.tags.push("x");
  }
  get first(): string {
    return this.tags[0];
  }
}

interface Tagged {
  first: string;
}

interface Door {
  close(this: Own<this>): string;
}

class Gate {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  close(this: Own<this>): string {
    return "closed " + this.name;
  }
}

class Port {
  close(): string {
    return "shutting";
  }
}

function total(shapes: Ref<Dyn<Shape>[]>): i64 {
  let sum = 0;
  for (const s of shapes) sum += s.area();
  return sum;
}

function main() {
  let shapes: Dyn<Shape>[] = [new Sq(2), new Sq(3), new Named("n" + "")];
  console.log(shapes[0].area(), shapes[1].area(), shapes[2].area(), total(shapes));
  const t: Dyn<Tagged> = new Named("n" + "");
  console.log(shapes[0].label, shapes[2].label, t.first);
  let one: Dyn<Shape> = new Sq(2);
  one.grow(3);
  const big = one.area() / 5;
  one.grow(1);
  console.log(big, one.area() / 6);
  const g: Dyn<Door> = new Gate("main" + "");
  const p: Dyn<Door> = new Port();
  const a = g.close();
  const b = p.close();
  console.log(a, b);
}
