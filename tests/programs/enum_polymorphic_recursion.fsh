enum Maybe<T> { Some(T), Nothing }
function deep<T>(x: T, n: i64): i64 { if (n === 0) return 0; return deep(Maybe.Some(x), n - 1); }
function main() { console.log(deep(1, 3)); }
// error: instantiating 'deep' never ends
