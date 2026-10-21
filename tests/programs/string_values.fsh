type P = { name: string; age: i64 };

class Pet {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  call(): string {
    return this.name;
  }
}

function pick(n: i64): string {
  if (n > 0) return "positive";
  return "not positive";
}

function main() {
  const a = "hello";
  let b: string = "world";
  console.log(a, b);
  console.log(pick(1), pick(-1));
  const p: P = { name: "Ann", age: 3 };
  console.log(p.name, p.age);
  const pet = new Pet("Rex");
  console.log(pet.call());
  b = "again";
  console.log(b);
  let t = "x";
  t = "y";
  console.log(t);
}
// expect: hello world
// expect: positive not positive
// expect: Ann 3
// expect: Rex
// expect: again
// expect: y
