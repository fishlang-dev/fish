// error: 'push' changes its array, and this one is read through a Dyn, which gives a copy; change it through a method
interface HasXs { xs: i64[]; }
class H { xs: i64[] = []; }
function k(d: Mut<Dyn<HasXs>>) { d.xs.push(2); console.log(d.xs.length); }
function main() { let h: Dyn<HasXs> = new H(); k(h); console.log(h.xs.length); }
