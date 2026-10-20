type K = "a" | "b"
type O = { k1: K; k2: K; k3: K; f: boolean }

function show(u: O | i64) {
  if (typeof u === "object") print(u.k1, u.k2, u.k3, u.f)
}

function main() {
  const o: O = { k1: "b", k2: "a", k3: "b", f: true }
  show(o)
}
// expect: b a b true
