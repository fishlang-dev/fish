// error: argument of type 'string' is not assignable to parameter of type '`${number}px`'
// A generic function given a pattern type argument keeps it in its parameters.
type Px = `${number}px`;
function id<T>(x: T): T { return x; }
function f(s: string): Px { return id<Px>(s); }
function main() {}
