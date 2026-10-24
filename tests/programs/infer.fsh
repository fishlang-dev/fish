// case: infer_callee_closure
function main() {
  let n = 0;
  const r = b();
  console.log(r, small(n));
}
function small(x: u8): u8 { return x * 2; }
function b() {
  const f = () => 1;
  return f();
}
// expect: 1 0
// case: infer_callee_error
function small(x: u8): u8 {
  return x + 2;
}

function main() {
  let n = 0;
  console.log(small(n), b());
}

function b() {
  const q: boolean = 5;
  return 1;
}
// error: type 'i64' is not assignable to type 'boolean'
// case: infer_conflict
function main() {
  const a: u8 = 1;
  const b: usize = 2;
  let n = 0;
  const x = n + a;
  const y = n + b;
}
// error: operator '+' can't mix 'u8' and 'usize'
// case: infer_from_use
function len(): usize {
  return 3;
}

function small(x: u8): u8 {
  return x * 2;
}

function count(): u32 {
  let n = 0;
  n += 7;
  return n;
}

function main() {
  let total: usize = 0;
  for (let i = 0; i < len(); i++) {
    total += i;
  }
  let b = 100;
  console.log(total, small(b), count());
  const wide: i32 = 40000;
  let w = 1;
  w = wide;
  let plain = 5;
  plain = plain * 3;
  let big = 1;
  big = big << 40;
  console.log(w, plain, big);
}
// expect: 3 200 7
// expect: 40000 15 1099511627776
// case: infer_negative_unsigned
function main() {
  const limit: usize = 3;
  let i = -1;
  console.log(i < limit);
}
// error: 'usize' is unsigned, so it can't be negative
// case: infer_switch_capture
function main() {
  let n = 3;
  const lim: u8 = 3;
  switch (n) {
    case lim:
      console.log("three");
      break;
    default:
      console.log("other");
  }
  let m = 0;
  const g = () => {
    const v: u16 = m;
    return v + 1;
  };
  console.log(g());
}
// expect: three
// expect: 1
