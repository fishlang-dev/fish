enum Result<T, E> {
  Ok(T),
  Err(E),
}

enum Maybe<T> {
  Some(T),
  Nothing,
}

type P = { name: string };

function parse(s: string): Result<i64, string> {
  if (s === "1") return Result.Ok(1);
  return Result.Err("bad " + s);
}

function wrap<T>(x: T): Maybe<T> {
  return Maybe.Some(x);
}

function take(r: Result<string, string>): i64 {
  return 1;
}

function main() {
  const a = parse("1");
  const b = parse("x");
  let c: Maybe<string> = Maybe.Nothing;
  c = Maybe.Some("s" + 1);
  const d = Maybe.Some({ name: "p" + 1 });
  const e: Maybe<P> = Maybe.Nothing;
  const f = wrap("w" + 2);
  const g = wrap(5);
  const h = Result.Ok<string, i64>("x" + 1);
  const n = take(Result.Err("e" + 3)) + take(Result.Ok("o"));
  const list: Maybe<i64>[] = [Maybe.Some(1), Maybe.Nothing];
  const nested: Maybe<Result<i64, string>> = Maybe.Some(parse("1"));
  console.log(n, list.length);
}
// expect: 2 2
