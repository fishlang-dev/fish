// expect: 2 1
// A spread of a named array clones it, which stays usable and changes apart from the copy.
function main() {
  let xs = ["a" + 1];
  const ys = [...xs];
  xs.push("b");
  console.log(xs.length, ys.length);
}
