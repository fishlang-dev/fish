// expect: other five n y false true
// expect: other five n y false true
// Comparing a union compares its member first, at comptime as at run time.
function small(): u8 { return 5; }
function big(): i64 { return 5; }
function sw(x: u8 | i64): string { switch (x) { case 5: return "five"; default: return "other"; } }
function eqLit(x: u8 | i64): string { return x === 5 ? "y" : "n"; }
function nul(x: u8 | i64 | null): string { const d: i64 = 5; return `${(x ?? d) === d}`; }
function all(): string { return `${sw(small())} ${sw(big())} ${eqLit(small())} ${eqLit(big())} ${nul(small())} ${nul(null)}`; }
function main() { console.log(all()); console.log(comptime all()); }
