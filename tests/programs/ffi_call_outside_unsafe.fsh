declare function abs(n: i32): i32;

function main() {
  console.log(abs(-1));
}
// error: calling the C function 'abs' can only happen inside 'unsafe { }': the compiler can't check what C code does
