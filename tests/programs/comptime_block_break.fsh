// error: 'break' can't leave a comptime block
// A comptime block runs while compiling, so nothing in it can jump out to the program.
function main() {
  while (true) {
    comptime { break; }
  }
}
