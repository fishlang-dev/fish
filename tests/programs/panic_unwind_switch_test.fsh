function boom(n: i64): i64 { const big: i64 = 9223372036854775807; return big + n }
function nil(): string { const o: string | null = null; return o! }
function main() {
  const s = "s" + 1
  switch (s + "!") {
    case "x" + 1: print("x"); break
    case "y" + boom(1): print("y"); break
    default: print("d")
  }
}
// panic: attempt to add with overflow
