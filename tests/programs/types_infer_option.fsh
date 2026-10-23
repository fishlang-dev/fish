// expect: 4 x
// 'Option<infer U>' matches each member of a union as 'U | null' does, so the empty value goes.
type Un<T> = T extends Option<infer U> ? U : "not";
type C = Un<i64 | string | null>;
function main() { const a: C = 4; const b: C = "x"; console.log(a, b); }
