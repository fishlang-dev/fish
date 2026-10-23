// error: 'includes' compares elements by value, which objects and instances can't do until they derive 'Eq'
class P { n: i64; constructor(n: i64) { this.n = n; } }
function main() { const ps = [new P(1)]; console.log(ps.includes(new P(1))); }
