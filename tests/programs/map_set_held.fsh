// error: cannot use 'm' while 'r' borrows 'm' mutably and is used later
function main() { let m = new Map<string, i64>(); let r = m.set("a", 1); m.clear(); r.set("b", 2); }
