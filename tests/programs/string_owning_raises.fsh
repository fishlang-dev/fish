class Pet {
  name: string;
  constructor(n: string) {
    this.name = n + "!";
  }
  close(this: Own<this>, fail: boolean): string throws string {
    if (fail) throw "closed " + this.name;
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

function no(n: i64): boolean throws string {
  if (n > 0) throw "no" + n;
  return false;
}

function main() {
  try {
    console.log(new Pet("a").close(no(1)));
  } catch (e) {
    console.log(e);
  }
  try {
    console.log(new Dog("a", "b").close(true));
  } catch (e) {
    console.log(e);
  }
  try {
    console.log(new Dog("c", "d").close(false));
  } catch (e) {
    console.log(e);
  }
}
// expect: no1
// expect: closed a!
// expect: c!
