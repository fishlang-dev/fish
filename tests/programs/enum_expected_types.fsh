enum Maybe<T> {
  Some(T),
  Nothing,
}

function wrapObj(o: { a: string }): Maybe<{ a: string }> {
  return Maybe.Some(o);
}

function takeSmall(m: Maybe<i32>): i64 {
  return 1;
}

class Holder {
  m: Maybe<string>;
  constructor(m: Maybe<string>) {
    this.m = m;
  }
}

function main() {
  const n = wrapObj({ a: "z" + 1 });
  const small: Maybe<i32> = Maybe.Some(5);
  const f: Maybe<f64> = Maybe.Some(1);
  let list: Maybe<string>[] = [];
  list.push(Maybe.Nothing);
  list.push(Maybe.Some("s" + 1));
  const h = new Holder(Maybe.Nothing);
  const nested: Maybe<Maybe<string>> = Maybe.Some(Maybe.Nothing);
  console.log(takeSmall(Maybe.Some(7)), list.length);
}
// expect: 1 2
