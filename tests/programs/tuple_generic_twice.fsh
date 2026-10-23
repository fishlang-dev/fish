// expect: 1 s1 true
// A tuple literal passed to a generic function from a generic body checked per instance.
function swap<A, B>(t: [A, B]): [B, A] { return [t[1], t[0]]; }
function g<T>(x: T): [i64, T] { return swap([x, 1]); }
function main() { const a = g("s" + 1); const b = g(true); console.log(a[0], a[1], b[1]); }
