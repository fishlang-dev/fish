// expect: 3
// A loop over a string reached through a reference.
function r(s: Ref<string>): i64 { let n = 0; for (const c of s) n++; return n; }
function main() {
  let t = "abc" + "";
  console.log(r(t));
}
