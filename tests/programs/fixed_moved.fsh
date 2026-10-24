// error: 'ps[0].n' can't be used here because 'ps' was moved
class P { n: i64; constructor(n: i64) { this.n = n; } } function main() { const ps: FixedArray<P, 1> = [new P(1)]; const q = ps; console.log(ps[0].n); }
