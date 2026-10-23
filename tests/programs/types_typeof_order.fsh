// expect: 3 t
// A body checked to infer another's result sees only its own names, in either order.
const LIMIT: i64 = 5;
function main() { const LIMIT = "t"; const r: ReturnType<typeof f> = f(); console.log(r, LIMIT); }
function f() { const v = 3 as typeof LIMIT; return v; }
