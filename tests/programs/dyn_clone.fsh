// expect: 9 4 4
// expect: copy of a 1
interface Shape {
  area(): i64;
  grow(this: Mut<this>): void;
}

class Sq {
  side: i64;
  tags: string[] = ["t" + ""];
  constructor(side: i64) {
    this.side = side;
  }
  area(): i64 {
    return this.side * this.side;
  }
  grow(this: Mut<this>) {
    this.side++;
    this.tags.push("g");
  }
}

interface Labelled {
  label(): string;
}

class Tag {
  name: string;
  copies: i64;
  constructor(name: string, copies: i64) {
    this.name = name;
    this.copies = copies;
  }
  label(): string {
    return this.name + " " + this.copies;
  }
  clone(): Tag {
    return new Tag("copy of " + this.name, this.copies + 1);
  }
}

function main() {
  let a: Dyn<Shape> = new Sq(2);
  let b = a.clone();
  a.grow();
  const c = b.clone();
  console.log(a.area(), b.area(), c.area());
  const t: Dyn<Labelled> = new Tag("a" + "", 0);
  const u = t.clone();
  console.log(u.label());
}
