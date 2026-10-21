type Box = { name: string };

function take(b: Box): string {
  return b.name;
}

function main() {
  const box: Box = { name: "crate" };
  console.log(box |> take(%));
  console.log(box.name);
}
// error: 'box.name' can't be used here because 'box' was moved
