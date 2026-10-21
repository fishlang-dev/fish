enum Maybe<T> { Some(T), Nothing }
function main() { const c = true; const m: Maybe<string> = c ? Maybe.Some("a") : Maybe.Nothing; console.log(1); }
// expect: 1
