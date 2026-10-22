function* each(xs: Ref<string[]>): Generator<string> {
  for (const x of xs) yield x + "!";
}
function main() {
  let arr = ["a" + 1, "b" + 2];
  for (const s of each(arr)) {
    console.log(s);
    arr.push("c" + 3);
    arr.push("d" + 4);
    arr.push("e" + 5);
  }
}
// error: cannot change 'arr' while a 'for...of' loop borrows 'arr' and is used later
