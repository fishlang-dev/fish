type P = { a: string; b: i64 };

function fail(n: i64): i64 throws string {
  if (n > 0) throw "bad" + n;
  return n;
}

function key(n: i64): string throws string {
  if (n > 0) throw "key" + n;
  return "k";
}

function two(a: string, b: i64): i64 {
  return b;
}

function apply(f: (s: string) => i64): i64 {
  return f("a" + 1);
}

function main() {
  try {
    two("a" + 1, fail(1));
  } catch (e) {
    console.log(e);
  }
  const moved: P = { a: "m" + 1, b: 1 };
  try {
    const q: P = { a: moved.a + "", b: fail(2) };
  } catch (e) {
    console.log(e);
  }
  try {
    switch ("s" + 1) {
      case key(3):
        console.log("hit");
    }
  } catch (e) {
    console.log(e);
  }
  console.log(apply(() => 7));
}
// expect: bad1
// expect: bad2
// expect: key3
// expect: 7
