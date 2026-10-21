function main() {
  const n = 3;
  console.log(n |> match (5) {
    case n => n * 10 + %,
  });
}
// error: this 'n' hides the 'n' the pipe reads for '%'; rename it
