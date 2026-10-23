// expect: B.X B.X
// Members of two enums sharing a value make instances of their own, and compare equal, as at run time.
enum A { X, Y }
enum B { X, Y }
function which(comptime v: A | B): string {
  if (v === B.X) return "B.X";
  if (v === A.X) return "A.X";
  return "other";
}
function main() { console.log(which(A.X), which(B.X)); }
