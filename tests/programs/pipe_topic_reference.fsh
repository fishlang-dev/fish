type Box = { name: string };

function make(): Box {
  return { name: "made" };
}

function name(b: Ref<Box>): Ref<string> {
  return b.name;
}

function main() {
  const n = make() |> name(%);
  console.log(n);
}
// error: a pipe over a value can't give a reference yet
