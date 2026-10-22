// error: cannot call 'bump' on 'one' because it is a constant
interface Counter {
  bump(this: Mut<this>): void;
}

class C {
  n: i64 = 0;
  bump(this: Mut<this>) {
    this.n++;
  }
}

function main() {
  const one: Dyn<Counter> = new C();
  one.bump();
}
