// A closure can't change what a captured shared reference points to.
class P { x = 0 }
function f(r: Ref<P>) {
  const g = () => { r.x = 2 }
}
function main() {}
// error: cannot assign to 'r.x' because 'r' is a shared reference ('Ref'), which only reads
