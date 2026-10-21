// A case that gives a narrowed mutable reference another member doesn't carry the narrowing
// into the case it falls through to.
type P = { kind: "p"; x: i64 }
type Q = { kind: "q"; z: i64 }
type R = { kind: "r"; z: i64 }

function f(m: Mut<P | Q | R>): i64 {
  switch (m.kind) {
    case "q":
      m = { kind: "p", x: 1 }
    case "r":
      return m.z
  }
  return 0
}

function main() {}
// error: property 'z' does not exist
