// case: unsafe_cast_outside
function main() {
  const x = 1;
  const p = ptrOf(x);
  console.log(p as usize);
}
// error: 'as' with a raw pointer can only happen inside 'unsafe { }'
// case: unsafe_expected_types
type R = { a: u8 };
function main() {
  const r: R = unsafe { { a: 200 } };
  const xs: u8[] = unsafe { [1, 2] };
  const s: string = unsafe { "lit" };
  const o: string | null = unsafe { "maybe" + 1 };
  console.log(r.a, xs[1], s, o ?? "none");
}
// expect: 200 2 lit maybe1
// case: unsafe_mut_ptr_of_const
function main() {
  const x = 1;
  const p = mutPtrOf(x);
}
// error: cannot point mutably at 'x' because it is a constant
// case: unsafe_null_outside
function main() {
  const p = nullPtr<u8>();
}
// error: 'nullPtr' can only happen inside 'unsafe { }'
// case: unsafe_operations
type Point = { x: f64; y: f64 };

function sum(start: Ptr<i64>, count: i64): i64 {
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += unsafe { start.offset(i).read() };
  }
  return total;
}

function bump(p: MutPtr<i32>, by: i32) {
  unsafe {
    p.write(p.read() + by);
  }
}

function main() {
  const xs = [10, 20, 30, 40];
  console.log(sum(ptrOf(xs[0]), 4), sum(ptrOf(xs[1]), 2));
  let n: i32 = 1;
  bump(mutPtrOf(n), 41);
  console.log(n);
  let flag = false;
  const f = mutPtrOf(flag);
  unsafe {
    f.write(true);
  }
  console.log(flag);
  const p = ptrOf(xs[2]);
  const address = unsafe { p as usize };
  const back = unsafe { address as Ptr<i64> };
  console.log(back === p, unsafe { back.read() });
  const none = unsafe { nullPtr<i64>() };
  console.log(unsafe { none.isNull() }, unsafe { p.isNull() });
  let target: f64 = 1.5;
  const holder = mutPtrOf(target);
  let slot: MutPtr<f64> = unsafe { nullPtr<f64>() };
  const where = mutPtrOf(slot);
  unsafe {
    where.write(holder);
    slot.write(2.25);
  }
  console.log(target);
  const pt: Point = { x: 1.0, y: 2.0 };
  const viaCast = unsafe { (ptrOf(pt) as Ptr<f64>).offset(1).read() };
  console.log(viaCast);
}
// expect: 100 50
// expect: 42
// expect: true
// expect: true 30
// expect: true false
// expect: 2.25
// expect: 2
// case: unsafe_optional_chain
function main() { const xs = [10]; const o: Option<Ptr<i64>> = ptrOf(xs[0]); const v = unsafe { o?.read() }; }
// error: optional chains calling raw pointer methods are not supported yet
// case: unsafe_pointers
type Box = { size: i64 };

function same(a: Ptr<i64>, b: Ptr<i64>): boolean {
  return a === b;
}

function main() {
  let x = 5;
  const y = 6;
  const p = ptrOf(x);
  const q = ptrOf(x);
  const m: MutPtr<i64> = mutPtrOf(x);
  console.log(p === q, p === ptrOf(y), same(m, p), m !== p);
  const b: Box = { size: 3 };
  const r: Ref<Box> = b;
  const viaRef = ptrOf(r);
  console.log(viaRef === ptrOf(b));
  const unsafe = 1;
  const doubled = unsafe { unsafe * 2 };
  unsafe {
    const inner = unsafe { doubled + 1 };
    console.log(doubled, inner);
  }
}
// expect: true false true false
// expect: true
// expect: 2 3
// case: unsafe_ptr_of_temporary
function make(): i64 {
  return 1;
}

function main() {
  const p = ptrOf(make());
}
// error: 'ptrOf' needs a variable or a field to point at
// case: unsafe_ptr_of_type_parameter
function at<T>(x: T): Ptr<T> { return ptrOf(x); }
function main() { const n = 5; const p = at(n); }
// error: 'ptrOf' calls on values whose type is a type parameter are not supported yet
// case: unsafe_read_outside
function main() {
  const x = 1;
  const p = ptrOf(x);
  console.log(p.read());
}
// error: 'read' on a raw pointer can only happen inside 'unsafe { }'
// case: unsafe_read_string
function main() {
  const s = "a" + 1;
  const p = ptrOf(s);
  unsafe {
    console.log(p.read());
  }
}
// error: raw reads and writes of 'string' are not supported yet
// case: unsafe_through_references
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
// case: unsafe_write_through_ptr
function main() {
  let x = 1;
  const p = ptrOf(x);
  unsafe {
    p.write(2);
  }
}
// error: 'write' needs a 'MutPtr'; a 'Ptr' only reads what it points at
