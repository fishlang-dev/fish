// error: this loop would read from a value made just for it, which is gone before the loop's first pass; give the value a name first, as in 'const xs = ...;'
class G { get nested(): FixedArray<FixedArray<string, 2>, 2> { return [["a" + 1, "b" + 1], ["c" + 1, "d" + 1]]; } get arr(): string[][] { return [["e" + 1, "f" + 1]]; } }
function main() {
  const g = new G();
  for (const x of g.nested[1]) console.log(x);
  for (const y of g.arr[0]) console.log(y);
}
