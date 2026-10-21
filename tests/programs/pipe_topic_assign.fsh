function main() {
  let x = 1;
  x |> (% = 5);
  console.log(x);
}
// error: '%' can't be assigned; it stands for the pipe's value, so assign to what you piped instead
