class Box<T> {
  v: T;
  constructor(v: T) {
    this.v = v;
  }
  get(): T {
    return this.v.clone();
  }
}

function main() {
  const b = new Box<string>("g" + 1);
  console.log(b.get(), b.v);
}
// expect: g1 g1
