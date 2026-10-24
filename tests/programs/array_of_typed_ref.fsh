// error: arrays of references are not supported yet
class P { n: i64; constructor(n: i64) { this.n = n; } }
function keep(p: Ref<P>): i64 { const rs = Array.of<Ref<P>>(p); return 1; }
function main() { console.log(keep(new P(1))); }
