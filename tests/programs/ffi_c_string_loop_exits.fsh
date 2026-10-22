declare function strlen(s: Ptr<u8>): usize;

function fail(n: i64): void throws i64 {
  if (n > 0) throw n;
}

function ret(): i64 {
  let i = 0;
  do {
    if (i === 1) return i;
    i++;
  } while (unsafe { strlen(cString("w" + i)) } < 5);
  return -1;
}

function thr(): i64 throws i64 {
  let i = 0;
  do {
    fail(i);
    i++;
  } while (unsafe { strlen(cString("w" + i)) } < 5);
  return -1;
}

function upd(): i64 {
  for (let i = 0; i < 5; i = i + (unsafe { strlen(cString("u")) } as i64)) {
    if (i === 2) return i;
  }
  return -1;
}

function cond(): i64 {
  let i = 0;
  while (unsafe { strlen(cString("w" + i)) } < 5) {
    if (i === 3) return i;
    i++;
  }
  return -1;
}

function main() {
  console.log(ret(), upd(), cond());
  try {
    console.log(thr());
  } catch (e) {
    console.log("caught", e);
  }
}
// expect: 1 2 3
// expect: caught 1
