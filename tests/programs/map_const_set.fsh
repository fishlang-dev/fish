// error: cannot add to 'm' because it is a constant
function main() { const m = new Map<string, i64>(); m.set("a", 1); }
