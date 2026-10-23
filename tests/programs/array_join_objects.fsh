// error: 'join' writes each element as 'String(x)' does, which works for numbers, booleans and strings
class P { n: i64; constructor(n: i64) { this.n = n; } }
function main() { const ps = [new P(1)]; console.log(ps.join()); }
