// expect: 3 8 10 -2
// expect: 5 11
// expect: clicked 7
// expect: 20 21
type Request = { path: string; n: i64 };

class Button {
  onClick: (n: i64) => string;
  constructor(onClick: (n: i64) => string) {
    this.onClick = onClick;
  }
  press(n: i64): string {
    return this.onClick(n);
  }
}

function adder(by: i64): (x: i64) => i64 {
  return (x) => x + by;
}

function apply(f: (x: i64) => i64, x: i64): i64 {
  return f(x);
}

function main() {
  const tag = "x" + "";
  let handlers: ((r: Request) => i64)[] = [];
  handlers.push((r) => r.n + 1);
  handlers.push((r) => r.n * 4 + (tag.length as i64) - 1);
  handlers.push((r) => r.n + (r.path.length as i64) + 6);
  const req: Request = { path: "/a" + "", n: 2 };
  console.log(handlers[0](req.clone()), handlers[1](req.clone()), handlers[2](req), handlers[0]({ path: "", n: -3 }));
  const add2 = adder(2);
  const add5 = adder(5);
  console.log(add2(3), add5(6));
  const label = "clicked " + "";
  const b = new Button(move (n) => label + n);
  console.log(b.press(7));
  let f: (x: i64) => i64 = (x) => x * 2;
  const first = apply(f, 10);
  f = adder(11);
  console.log(first, f(10));
}
