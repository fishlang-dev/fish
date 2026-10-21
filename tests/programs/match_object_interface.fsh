interface HasA {
  a: i64;
}

class K {
  a: i64;
  constructor(a: i64) {
    this.a = a;
  }
}

function f(x: HasA): string {
  return match (x) {
    case { a: 1 } => "one",
    case { a } => "a=" + a,
  };
}

function main() {
  console.log(f(new K(1)), f(new K(4)), f({ a: 1, b: true }));
}
// expect: one a=4 one
