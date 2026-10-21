// A switch on a float compares as floats do.
function main() {
  const f: f32 = 2
  switch (f) {
    case 2: print("two"); break
    default: print("other")
  }
}
// expect: two
