// error: cannot change 'm' while a 'for...of' loop is reading 'm'
function main() { let m = new Map<string, i64>(); m.set("a", 1); for (const [k, v] of m) m.set(k, v + 1); }
