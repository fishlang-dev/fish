enum Color { Red = 4 }
function at(r: Ref<Ptr<i64>>, i: i64): i64 { return unsafe { r.offset(i).read() }; }
function bumpVia(r: Ref<MutPtr<i64>>) { unsafe { r.write(r.read() + 1); } }
function step<T>(p: Ptr<T>, i: i64): Ptr<T> { return unsafe { p.offset(i) }; }
function main() {
  const xs = [10, 20, 30];
  const p = ptrOf(xs[0]);
  console.log(at(p, 2));
  let n = 5;
  const m = mutPtrOf(n);
  bumpVia(m);
  console.log(n);
  const b: i32 = -1;
  const r = unsafe { b as MutPtr<u8> };
  console.log(unsafe { r as usize });
  const z = unsafe { 0 as Ptr<u8> };
  const c = unsafe { Color.Red as Ptr<u8> };
  console.log(unsafe { z.isNull() }, unsafe { c as usize });
  const f = unsafe { () => p.read() };
  console.log(f());
  const x: u8 = unsafe { 5 };
  console.log(x, unsafe { step(p, 1).read() });
}
// expect: 30
// expect: 6
// expect: 18446744073709551615
// expect: true 4
// expect: 10
// expect: 5 20
