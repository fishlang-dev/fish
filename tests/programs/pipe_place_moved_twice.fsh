type Box = { name: string };

function both(a: Box, b: Box): string {
  return a.name + b.name;
}

function main() {
  const box: Box = { name: "crate" };
  console.log(box |> both(%, %));
}
// error: 'box' was moved, so it can't be used here
