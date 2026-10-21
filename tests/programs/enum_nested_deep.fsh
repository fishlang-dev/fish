enum Maybe<T> { Some(T), Nothing }
function main() { const x: Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<Maybe<i64>>>>>>>>>>>>>>>>>>>>>>>>>> = Maybe.Nothing; console.log(1); }
// expect: 1
