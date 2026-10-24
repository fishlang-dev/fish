// expect: 3 2 false true n,s
// expect: 2 2
// Keys of literal unions, enum members and sized integers.
type Dir = "n" | "s";
enum E { A, B }
function main() {
  let m = new Map<Dir, i64>();
  m.set("n", 1);
  m.set("s", 2);
  m.set("n", 3);
  let e = new Set<E>();
  e.add(E.B);
  console.log(m.get("n"), m.size, e.has(E.A), e.has(E.B), m.keys().join());
  let bytes = new Map<u8, i64>();
  bytes.set(1, 1);
  bytes.set(255, 2);
  console.log(bytes.size, bytes.get(255));
}
