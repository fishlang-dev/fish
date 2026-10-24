// error: 'set' changes its Map, so call it on a variable or a field
function main() { const m = new Map<string, i64>().set("a", 1); }
