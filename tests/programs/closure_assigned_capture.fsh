// A closure assigning a captured `let` doesn't narrow it, so it may give it another member.
type P = { kind: "p"; x: i64 }
type Q = { kind: "q"; z: i64 }
function main() {
  let u: P | Q = { kind: "p", x: 5 }
  if (u.kind === "p") {
    u = { kind: "q", z: 77 }
  }
  const g = () => {
    if (u.kind === "q") {
      u = { kind: "p", x: 1 }
    }
  }
  g()
  print(u.kind === "p")
}
// expect: true
