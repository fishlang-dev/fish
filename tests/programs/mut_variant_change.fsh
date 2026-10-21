// A whole value written through a narrowed mutable reference may change its member, and a
// mutable reference field is written through like a variable.
type P = { kind: "p"; x: i64 }
type Q = { kind: "q"; z: i64 }

function flip(m: Mut<P | Q>) {
  if (m.kind === "q") {
    m = { kind: "p", x: 4 }
  }
}

type H = { n: Mut<i64> }

function main() {
  let u: P | Q = { kind: "q", z: 1 }
  flip(u)
  let k = 0
  let h: H = { n: k }
  h.n = 7
  h.n += 2
  print(u.kind === "p" ? u.x : -1, k)
}
// expect: 4 9
