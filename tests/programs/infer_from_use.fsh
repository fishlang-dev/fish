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
