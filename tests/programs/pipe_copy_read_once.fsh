function three(a: i64, b: i64, c: i64): string {
  return `${a} ${b} ${c}`;
}

function main() {
  let x = 1;
  console.log(x |> three(%, (x = 2), %));
  const a = [10, 20, 30];
  let i: usize = 0;
  console.log(a[i] |> three(%, (i = i + 1) as i64, %));
}
// expect: 1 2 1
// expect: 10 1 10
