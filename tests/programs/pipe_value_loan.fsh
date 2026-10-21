function first(a: Ref<string[]>): Ref<string> {
  return a[0];
}

function show(k: usize, s: Ref<string>): string {
  return k + ":" + s;
}

function main() {
  let arr = ["a" + "-long"];
  console.log(first(arr) |> show((arr = ["zz", "q"]).length, %));
}
// error: cannot change 'arr' while
