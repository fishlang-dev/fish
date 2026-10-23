// expect: 1
// expect: 1
// 'this' lent to a Mut parameter is changed through it, at comptime too.
class C {
  n: i64;
  constructor() { this.n = 0; }
  bumpSelf(this: Mut<this>) { bump(this); }
}
function bump(c: Mut<C>) { c.n += 1; }
function all(): string {
  let c = new C();
  c.bumpSelf();
  return `${c.n}`;
}
function main() { console.log(all()); console.log(comptime all()); }
