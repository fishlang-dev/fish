// A shorthand of a narrowed variable holds the narrowed value, which may be Copy.
type P = { x: i64 }

function main() {
  const u: P | i64 = 5
  if (typeof u === "number") {
    const o = { u }
    print(o.u, u)
  }
}
// expect: 5 5
