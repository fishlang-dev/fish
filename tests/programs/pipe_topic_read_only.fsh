type Box = { name: string };

function make(): Box {
  return { name: "made" };
}

function main() {
  make() |> (%.name = "changed");
}
// error: cannot assign to '%.name' because '%' is a constant
