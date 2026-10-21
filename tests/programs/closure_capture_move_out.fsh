// A closure can't move a value out of a reference it captures.
class O { n = 1 }
function take(o: O) {}
function f(r: Ref<O>) {
  const g = () => take(r)
}
function main() {}
// error: can't move a value out of a reference to it, which only borrows it
