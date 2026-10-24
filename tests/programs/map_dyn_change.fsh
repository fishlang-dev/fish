// error: 'set' changes its Map, and this one is read through a Dyn, which gives a copy; change it through a method
interface HasMap { m: Map<string, i64>; }
class H { m: Map<string, i64> = new Map(); }
function main() { let h: Dyn<HasMap> = new H(); h.m.set("a", 1); console.log(h.m.size); }
