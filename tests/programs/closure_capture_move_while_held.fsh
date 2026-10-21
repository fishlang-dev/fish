// What a closure captures can't move while the closure is still called.
class O { n = 1 }
function take(o: O) {}
function main() {
  const o = new O()
  const g = () => o.n
  take(o)
  print(g())
}
// error: cannot move 'o' while 'g' borrows 'o' and is used later
