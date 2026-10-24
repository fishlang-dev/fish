// error: 's' is borrowed mutably twice in one value, which would let one change what the other reads
function main() { let s = "a" + 1; let o: { a: Mut<string>; b: Mut<string> } = { a: s, b: s }; o.a = "x"; console.log(o.b); }
