function* gen(xs: Ref<string[]>): Generator<string> {
  yield xs[0] + "!";
}
function main() {
  const g = gen(["a" + 1, "b" + 2]);
  for (const x of g) console.log(x);
}
// error: 'g' would keep borrowing this temporary
