// A branch that gives a narrowed mutable reference another member doesn't carry the narrowing
// past the `if`, even when the other branch leaves.
type P = { kind: "p"; x: i64; y: i64 }
type Q = { kind: "q"; z: i64 }

function f(m: Mut<P | Q>): i64 {
  if (m.kind === "q") {
    m = { kind: "p", x: 77, y: 88 }
  } else {
    return 0
  }
  return m.z
}

function main() {}
// error: property 'z' does not exist
