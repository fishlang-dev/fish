// error: type 'string' is not assignable to return type '`${number}px`'
// A plain string might not match, so it doesn't fit a pattern.
type Px = `${number}px`;
function f(s: string): Px { return s; }
function main() {}
