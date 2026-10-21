type Box = { name: string };

function make(): Box {
  return { name: "made" };
}

function both(a: Box, b: Box): string {
  return a.name + b.name;
}

function main() {
  console.log(make() |> both(%, %));
}
// error: '%' was moved, so it can't be used here
