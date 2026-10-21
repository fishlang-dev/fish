type P = { name: string; age: i64 };

class Pet {
  name: string;
  tag: string | null;
  constructor(name: string) {
    this.name = name + "!";
    this.tag = null;
  }
  rename(this: Mut<this>, to: string) {
    this.name = to + "?";
  }
  close(this: Own<this>): string {
    return this.name;
  }
}

class Dog extends Pet {
  breed: string;
  constructor(name: string, breed: string) {
    super(name);
    this.breed = breed + "";
  }
}

function make(n: i64): P {
  return { name: "p" + n, age: n };
}

function main() {
  const a = make(1);
  const b = a;
  let c = make(2);
  c = make(3);
  console.log(b.name, c.name);
  let pet = new Pet("rex");
  pet.rename("max" + 1);
  pet.tag = "t" + 1;
  console.log(pet.name, pet.tag);
  const named = pet.close();
  console.log(named);
  const d = new Dog("fido", "lab");
  console.log(d.name, d.breed);
  let u: string | i64 = "x" + 1;
  const u2 = u;
  u = 5;
  console.log(u2, u);
  let o: string | null = "o" + 1;
  const kept = o ?? "none";
  o = null;
  console.log(kept, o);
  console.log(make(4).name, new Pet("tmp").name);
  const label = "cap" + 1;
  const f = () => label + "!";
  console.log(f());
  const moved = make(7);
  const g = move () => moved.name;
  console.log(g());
}
// expect: p1 p3
// expect: max1? t1
// expect: max1?
// expect: fido! lab
// expect: x1 5
// expect: o1 null
// expect: p4 tmp!
// expect: cap1!
// expect: p7
