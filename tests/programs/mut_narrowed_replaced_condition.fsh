// A narrowed mutable reference is given another member only as a statement of its own: inside
// a condition, what the condition proves could still claim the old member.
type P = { kind: "p"; x: i64; y: i64 }
type Q = { kind: "q"; z: i64 }

function f(m: Mut<P | Q>): i64 {
  if (m.kind === "q" && (m = { kind: "p", x: 77, y: 88 }).kind === "p") {
    return m.z
  }
  return 0
}

function main() {}
// error: can't give 'm' another member inside a larger expression while a check narrows it
