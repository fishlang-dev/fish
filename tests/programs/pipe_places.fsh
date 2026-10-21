type Box = { name: string; size: i64 };

class Counter {
  n: i64;
  constructor(n: i64) {
    this.n = n;
  }

  doubled(): i64 {
    return this.n |> % * 2;
  }
}

function double(n: i64): i64 {
  return n * 2;
}

function add(a: i64, b: i64): i64 {
  return a + b;
}

function describe(b: Ref<Box>): string {
  return b.name + ":" + b.size;
}

function apply(f: (k: i64) => i64): i64 {
  return f(1);
}

function take(b: Box): string {
  return "took " + b.name;
}

function main() {
  const n = 3;
  console.log(n |> add(double(%), %) + 1);
  const box: Box = { name: "crate", size: 4 };
  console.log(box |> describe(%), box.name |> %.length, box.size |> add(%, n |> % * 10));
  console.log(box |> describe(%));
  const names = ["a", "bc"];
  console.log(names |> %.length, names[1] |> % + "!", names.length);
  console.log(new Counter(21).doubled());
  n |> console.log(%, "as a statement");
  const label = n |> match (%) {
    case 3 => "three",
    case _ => "other",
  };
  console.log(label, n |> apply((k: i64) => k + %));
  console.log(box |> take(%));
}
// expect: 10
// expect: crate:4 5 34
// expect: crate:4
// expect: 2 bc! 2
// expect: 42
// expect: 3 as a statement
// expect: three 4
// expect: took crate
