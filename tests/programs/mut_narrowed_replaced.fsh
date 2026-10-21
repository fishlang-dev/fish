// After a whole value of another member goes through a narrowed mutable reference, it reads
// as declared again.
type P = { kind: "p"; x: i64 }
type Q = { kind: "q"; z: i64 }

function f(m: Mut<P | Q>) {
  if (m.kind === "q") {
    m = { kind: "p", x: 4 }
    print(m.z)
  }
}

function main() {}
// error: property 'z' does not exist
