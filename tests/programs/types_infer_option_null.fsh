// error: type 'null' is not assignable to type 'i64 | string'
type Un<T> = T extends Option<infer U> ? U : "not";
type C = Un<i64 | string | null>;
function main() { const c: C = null; }
