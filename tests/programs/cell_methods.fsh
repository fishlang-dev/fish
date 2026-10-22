// expect: 1 2 3
// expect: a ab
// expect: b c
function bump(c: Ref<Cell<i64>>) {
  c.set(c.get() + 1);
}

class Names {
  last: Cell<string> = new Cell("a");
}

function main() {
  const c = new Cell(1);
  const one = c.get();
  bump(c);
  const two = c.get();
  const old = c.replace(3);
  console.log(one, old, c.get());
  const s = new Cell("a" + "");
  const was = s.replace("ab" + "");
  console.log(was, s.replace("x"));
  const n = new Names();
  n.last.set("b" + "");
  const b = n.last.replace("c");
  console.log(b, n.last.replace("d"));
  const unused = two;
}
