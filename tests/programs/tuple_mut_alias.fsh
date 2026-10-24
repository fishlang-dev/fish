// error: 's' is borrowed mutably twice in one value, which would let one change what the other reads
function main() { let s = "a" + 1; let t: [Mut<string>, Mut<string>] = [s, s]; t[0] = "x"; console.log(t[1]); }
