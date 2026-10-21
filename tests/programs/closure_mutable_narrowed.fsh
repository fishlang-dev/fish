// A closure can't change the member of a variable a check outside it narrowed.
type P = { kind: "p"; x: i64 }
type Q = { kind: "q"; z: i64 }
function f(m: Mut<P | Q>) {
  if (m.kind === "q") {
    const g = () => { m = { kind: "p", x: 1 } }
    g()
  }
}
function main() {}
// error: can't give 'm' another member inside a closure while a check outside it narrows it
