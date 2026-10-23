// error: 'return' can't leave a comptime block
// A return in a comptime block would leave while compiling, so it is refused.
function f(): i64 {
  comptime { return 5; }
  return 1;
}
function main() { console.log(f()); }
