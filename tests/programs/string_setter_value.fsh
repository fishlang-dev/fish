class Pet {
  name: string;
  constructor(n: string) {
    this.name = n + "!";
  }
  get loud(): string {
    return this.name + "!!";
  }
  set loud(v: string) {
    this.name = v + "";
  }
}

function main() {
  let pet = new Pet("a");
  console.log(pet.loud = "set" + 1);
  const t = (pet.loud += "x");
  console.log(t, pet.name);
}
// expect: set1
// expect: set1!!x set1!!x
