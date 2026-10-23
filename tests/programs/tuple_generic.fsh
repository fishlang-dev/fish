// expect: seven1 7
// A tuple literal passed to a generic function infers its type arguments element by element.
function swap<A, B>(t: [A, B]): [B, A] { return [t[1], t[0]]; } function main() { const s = swap([7, "seven" + 1]); console.log(s[0], s[1]); }
