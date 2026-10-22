// error: a 'Dyn<Counter>' may cross to another thread, so it can't hold a 'Cell<i64>', which changes without a lock
interface Counter {
  count(): i64;
}

class Local {
  n: Cell<i64> = new Cell(0);
  count(): i64 {
    return this.n.get();
  }
}

function main() {
  const c: Dyn<Counter> = new Local();
}
