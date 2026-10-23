// expect: mine 3
// A program's own Partial wins over the std one, everywhere in the program.
type Partial<T> = { mine: T };
function main() {
  const p: Partial<i64> = { mine: 3 };
  console.log("mine", p.mine);
}
