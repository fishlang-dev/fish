class Oops {
  why: string;
  constructor(why: string) {
    this.why = why;
  }
}

function risky(n: i64): i64 throws Oops {
  if (n === 2) throw new Oops("two " + n);
  return n * 10;
}

function* grid(rows: i64, cols: i64): Generator<string> {
  for (let r = 0; r < rows; r++) {
    const label = "r" + r;
    let c = 0;
    while (c < cols) {
      if (c === 1 && r === 1) {
        c++;
        continue;
      }
      yield label + "c" + c;
      c++;
    }
  }
}

function* doubled(n: i64): Generator<string> {
  for (const s of grid(n, 2)) {
    yield s + s;
  }
}

function* kinds(xs: i64[]): Generator<string> {
  for (const x of xs) {
    switch (x) {
      case 0:
        yield "zero";
        break;
      case 1:
        yield "one";
        yield "uno";
        break;
      default:
        if (x > 5) return;
        yield "many " + x;
    }
  }
  yield "end";
}

function* careful(n: i64): Generator<string> {
  for (let i = 0; i < n; i++) {
    try {
      const v = risky(i);
      yield "ok " + v;
    } catch (e) {
      yield "caught " + e.why;
    }
  }
}

function main() {
  for (const s of grid(2, 3)) console.log(s);
  for (const s of doubled(1)) console.log(s);
  for (const s of kinds([0, 1, 3, 9, 4])) console.log(s);
  for (const s of careful(3)) console.log(s);
  let partway = doubled(2);
  partway.next();
  let inner = careful(4);
  inner.next();
  inner.next();
  for (const s of kinds([1])) {
    console.log(s);
    break;
  }
}
// expect: r0c0
// expect: r0c1
// expect: r0c2
// expect: r1c0
// expect: r1c2
// expect: r0c0r0c0
// expect: r0c1r0c1
// expect: zero
// expect: one
// expect: uno
// expect: many 3
// expect: ok 0
// expect: ok 10
// expect: caught two 2
// expect: one
