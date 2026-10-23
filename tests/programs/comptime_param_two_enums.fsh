// expect: B.X B.X
// Members of two enums sharing a value compare equal, at comptime as at run time, where literals
// compare by value.
enum A { X, Y }
enum B { X, Y }
function which(comptime v: A | B): string {
  if (v === B.X) return "B.X";
  if (v === A.X) return "A.X";
  return "other";
}
function main() { console.log(which(A.X), which(B.X)); }
