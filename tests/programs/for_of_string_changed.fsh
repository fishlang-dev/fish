// expect: abcdabcd
// The loop holds its own string, so its variable may change inside it.
function main() {
  let t = "abc" + "d";
  for (const ch of t) { t = t + ch; }
  console.log(t);
}
