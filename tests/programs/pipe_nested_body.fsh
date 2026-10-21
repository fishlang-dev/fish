type Box = { name: string };

function inc(n: i64): i64 {
  return n + 1;
}

function make(): Box {
  return { name: "made" };
}

function main() {
  const x = 10;
  console.log(x |> (inc(%) |> % * 100), x |> 5 + (inc(%) |> % * 100));
  console.log(make() |> (%.name.length |> % * 100));
  const b = make();
  b |> (%.name |> console.log(%));
}
// expect: 1100 1105
// expect: 400
// expect: made
