// An object type can hold a reference.
type Holder = { r: Ref<i64> }

function main() {
  const n = 4
  const h: Holder = { r: n }
  print(h.r + 1)
}
// expect: 5
