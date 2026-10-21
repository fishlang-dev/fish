// A closure that only borrows what it captures can't move it.
class O { n = 1 }
function take(o: O) {}
function main() {
  const o = new O()
  const g = () => take(o)
}
// error: 'o' can't be moved here: this closure only borrows it; use 'o.clone()'
