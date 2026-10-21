class Oops {
  constructor() {}
}

function f(n: i64): i64 throws Oops {
  return match (n) {
    case _ => {
      throw new Oops();
    },
  };
}

function main() throws Oops {
  console.log(f(0));
}
// error: no arm of this match gives a value
