enum Maybe<T> {
  Some(T),
  Nothing,
}

function main() {
  const x = Maybe.Some<i64, string>(1);
}
// error: enum 'Maybe' takes 1 type argument
