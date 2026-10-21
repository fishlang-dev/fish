// mode: abort
function main() {
  const o: string | null = null;
  console.log(o!);
}
// panic: called `Option::unwrap()` on a `None` value
