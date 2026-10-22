// error: 'C' can't be a 'Dyn<Counter>': its method 'bump' changes its object, which 'Counter' doesn't declare; declare 'this: Mut<this>' on it in the interface
interface Counter {
  bump(): void;
}

class C {
  n: i64 = 0;
  bump(this: Mut<this>) {
    this.n++;
  }
}

function main() {
  let one: Dyn<Counter> = new C();
}
