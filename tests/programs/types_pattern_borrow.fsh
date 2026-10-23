// error: argument of type 'string' is not assignable to parameter of type 'Ref<`${number}px`>'
type Px = `${number}px`;
function size(r: Ref<Px>): i64 { return 1; }
function f(s: string): i64 { return size(s); }
function main() {}
