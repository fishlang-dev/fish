class Pet {
  name: string;
  constructor(n: string) {
    this.name = n + "!";
  }
  greet(s: string): string {
    return this.name + s;
  }
}

function maybe(n: i64): Pet | null {
  if (n > 0) return new Pet("p");
  return null;
}

function main() {
  const p = maybe(1);
  console.log(p?.greet(`n${5}`));
  console.log(maybe(0)?.greet("x" + 1), maybe(2)?.greet("y" + 2));
}
// expect: p!n5
// expect: null p!y2
