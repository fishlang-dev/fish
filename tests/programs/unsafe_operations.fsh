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
