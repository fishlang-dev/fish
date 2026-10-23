// error: 't.1' can't be used here because 't' was moved
class P { n: i64; constructor(n: i64) { this.n = n; } } function main() { const t: [P, i64] = [new P(1), 2]; const u = t; console.log(t[1]); }
