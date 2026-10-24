// error: cannot mutably lend 'm' while 'm' is lent to 'forEach' for this call
function main() { let m = new Map<string, i64>(); m.set("a", 1); m.forEach((v, k) => { m.delete(k); }); }
