// A closure narrowing a captured `Mut` itself may give it another member after the check.
type P = { kind: "p"; x: i64 }
type Q = { kind: "q"; z: i64 }
function plain(u: Mut<P | Q>): i64 {
  if (u.kind !== "p") return 0
  const v = u.x
  u = { kind: "q", z: 1 }
  return v
}
function f(u: Mut<P | Q>): i64 {
  const g = () => {
    if (u.kind !== "p") return 0
    const v = u.x
    u = { kind: "q", z: 1 }
    return v
  }
  return g()
}
function main() { let v: P | Q = { kind: "p", x: 5 }; print(plain(v)); let w: P | Q = { kind: "p", x: 6 }; print(f(w)) }
// expect: 5
// expect: 6
