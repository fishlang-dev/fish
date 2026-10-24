// expect: 5 s1
// FixedArray.filled in a generic body, each instance its own.
function wrap<T>(x: T): FixedArray<T, 2> { return FixedArray.filled<T, 2>(x); }
function main() { const b = wrap(5); const c = wrap("s" + 1); console.log(b[1], c[0]); }
