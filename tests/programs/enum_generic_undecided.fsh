enum Maybe<T> {
  Some(T),
  Nothing,
}

function main() {
  const x = Maybe.Nothing;
}
// error: can't tell what 'T' is for 'Maybe.Nothing'
