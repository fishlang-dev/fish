enum Maybe<T> { Some(T), Nothing }
function main() {
  let a: Maybe<string> | Maybe<i64> = Maybe.Some(5);
  a = Maybe.Some("s" + 1);
  let b: Maybe<i32> | Maybe<f64> = Maybe.Some(1.5);
  let c: Maybe<string[]> | Maybe<string> = Maybe.Some("x" + 1);
  c = Maybe.Some(["y" + 1]);
  console.log(1);
}
// expect: 1
