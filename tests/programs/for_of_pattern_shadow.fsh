// expect: 1
// The loop's body may declare a name its pattern binds.
function main() {
  const xs: [string, i64][] = [["a" + "", 1]];
  for (const [k, v] of xs) { const k = 1; console.log(k); }
}
