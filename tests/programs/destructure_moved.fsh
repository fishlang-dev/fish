// error: 'o.p.n' can't be used here because 'o.p' was moved
class P { n: i64 = 1; } function main() { const o = { p: new P(), k: 3 }; const { p } = o; console.log(o.p.n); }
