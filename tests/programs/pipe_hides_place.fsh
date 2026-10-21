function apply(f: (k: i64) => i64): i64 {
  return f(1);
}

function main() {
  const n = 3;
  console.log(n |> apply((n: i64) => n * 100 + %));
}
// error: this 'n' hides the 'n' the pipe reads for '%'; rename it
