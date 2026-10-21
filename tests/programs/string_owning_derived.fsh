class Pet {
  name: string;
  constructor(n: string) {
    this.name = n + "!";
  }
  close(this: Own<this>): string {
    return this.name;
  }
}

class Dog extends Pet {
  breed: string;
  constructor(n: string, b: string) {
    super(n);
    this.breed = b + "?";
  }
}

function main() {
  console.log(new Dog("a", "b").close());
  const d = new Dog("c", "d");
  console.log(d.close());
}
// expect: a!
// expect: c!
