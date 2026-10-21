enum Maybe<T> {
  Some(T),
  Nothing,
}

class Cache<T> {
  slot: Maybe<T>;
  constructor() {
    this.slot = Maybe.Nothing;
  }
  put(this: Mut<this>, v: T) {
    this.slot = Maybe.Some(v);
  }
}

function main() {
  let c = new Cache<string>();
  c.put("v" + 1);
  c.put("w" + 2);
  let d = new Cache<i64>();
  d.put(3);
  console.log("ok");
}
// expect: ok
