// expect: false false false false false false false
// expect: false false false false false false false
// A union field of an object keeps its member when the object is baked.
function small(): u8 { return 5; }
function kind(x: u8 | i64): string { const b: i64 = 5; return `${x === b}`; }
type Rec = { v: u8 | i64 };
type Outer = { r: Rec; vs: (u8 | i64)[] };
class Holder { v: u8 | i64; constructor() { this.v = small(); } }
enum Box { Of(u8 | i64) }
function a(): Rec { return { v: small() }; }
function b(): Rec { const r: Rec = { v: small() }; return r; }
function c(): Holder { return new Holder(); }
function d(): Outer { return { r: { v: small() }, vs: [small()] }; }
function e(): Box { return Box.Of(small()); }
function f(): Rec { let r: Rec = { v: 0 as i64 }; r.v = small(); return r; }
function eb(x: Box): string { return match (x) { case Box.Of(v) => kind(v) }; }
function main() {
  console.log(kind(a().v), kind(b().v), kind(c().v), kind(d().r.v), kind(d().vs[0]), eb(e()), kind(f().v));
  const A = comptime a(); const B = comptime b(); const C = comptime c(); const D = comptime d(); const E = comptime e(); const F = comptime f();
  console.log(kind(A.v), kind(B.v), kind(C.v), kind(D.r.v), kind(D.vs[0]), eb(E), kind(F.v));
}
