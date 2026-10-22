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
