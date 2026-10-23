// error: 'sort()' without a comparator orders numbers and strings, not 'P'
class P { n: i64; constructor(n: i64) { this.n = n; } } function main() { let ps = [new P(1)]; ps.sort(); }
