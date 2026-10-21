// An update through a narrowed mutable reference keeps its member, so narrowing holds; a whole
// value of another member ends the narrowing only after it.
type P = { kind: "p"; x: i64 }
type Q = { kind: "q"; z: i64 }

function h(m: Mut<i64 | boolean>) {
  if (typeof m === "number") {
    m = 3
    m++
    m += 10
  }
}

function f(m: Mut<P | Q>) {
  if (m.kind === "q") m = { kind: "p", x: 4 }
  else m.x = 9
}

function main() {
  let t: i64 | boolean = 1
  h(t)
  let u: P | Q = { kind: "q", z: 1 }
  f(u)
  f(u)
  print(t === 14, u.kind === "p" ? u.x : -1)
}
// expect: true 9
