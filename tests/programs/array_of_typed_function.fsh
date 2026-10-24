// expect: 1 k1!
// Array.of with a function element type stores callables as an annotated literal does.
function main() {
  const k = "k" + 1;
  const fs = Array.of<() => string>(() => k + "!");
  console.log(fs.length, fs[0]());
}
