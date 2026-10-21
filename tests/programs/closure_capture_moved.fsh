// A closure can't capture a moved variable.
class O { n = 1 }
function take(o: O) {}
function main() {
  const o = new O()
  take(o)
  const g = () => o.n
}
// error: 'o' was moved, so it can't be used here
