type A = { kind: "a"; n: i64 }
type B = { kind: "b"; n: i64 }
type C = { kind: "c" }

function main() {
  let x: A | B | C = { kind: "a", n: 1 }
  if (x.kind !== "c") {
    x.n = 5
  }
}
// error: narrow it to one member first
