type P = { name: string; n: i64 };

class Box {
  label: string;
  more: string;
  constructor(label: string, fail: boolean) {
    this.label = label + "!";
    const o: string | null = null;
    if (fail) console.log(o!);
    this.more = "m";
  }
}

function deep(n: i64, s: string): string {
  const local = s + n;
  const obj: P = { name: local + "?", n };
  if (n === 0) {
    const nothing: string | null = null;
    return nothing!;
  }
  return deep(n - 1, local);
}

function main() {
  const keep = "k" + 1;
  const f = () => keep + "!";
  for (let i = 0; i < 3; i++) {
    const it = "it" + i;
    try {
      const inner = f() + it;
      if (i === 2) console.log(deep(3, inner));
      if (i === 1) new Box("b" + i, false);
    } finally {
      console.log("finally runs only without a panic", i);
    }
  }
}
// mode: release
// expect: finally runs only without a panic 0
// expect: finally runs only without a panic 1
// panic: called `Option::unwrap()` on a `None` value
