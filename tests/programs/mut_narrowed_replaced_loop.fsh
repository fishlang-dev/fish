// A loop inside a narrowing check would come back to reads checked as narrowed.
type P = { kind: "p"; x: i64 }
type Q = { kind: "q"; z: i64 }

function f(m: Mut<P | Q>, n: i64) {
  if (m.kind === "q") {
    let i = 0
    while (i < n) {
      print(m.z)
      m = { kind: "p", x: 4 }
      i++
    }
  }
}

function main() {}
// error: can't give 'm' another member inside a loop here: a check outside the loop narrowed it
