// expect: false d 1
// expect: 3
type S = { n: i64; o: Option<Atomic<i64>>; name: string; db: { q: Atomic<i64>; label: string } };
function main() {
  const st = shared<S>({ n: 1, o: new Atomic(3), name: "x" + "", db: { q: new Atomic(0), label: "d" + "" } });
  console.log(st.o === null, st.db.label, st.db.label.length);
  const a: Option<Atomic<i64>> = new Atomic(1);
  if (a !== null) a.add(2);
  if (a !== null) console.log(a.load());
}
