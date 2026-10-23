// expect: 5 7
// A bound taking any string keeps the text, so a digit stays a string literal.
type T<S> = S extends `${infer N extends string | i64}` ? N : "no";
type I<S> = S extends `${infer N extends i64}` ? N : "no";
function main() { const a: T<"5"> = "5"; const b: I<"7"> = 7; console.log(a, b); }
