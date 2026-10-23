// error: 'Partial' of the type parameter 'T' isn't supported yet
// Utility types are computed while compiling from a type known then.
function patch<T>(x: T, p: Partial<T>): T { return x; }
function main() { console.log(patch(1, {})); }
