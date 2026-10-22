// expect: hi hi
function main() {
  const s = new Cell("h" + "i");
  const a = s.get();
  const b = s.get();
  console.log(a, b);
}
