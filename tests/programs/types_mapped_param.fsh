// error: 'keyof' of the type parameter 'T' isn't supported yet
// Inside generic function code, a mapped type over the function's own type parameter can't be
// computed, since T is only known per instance.
function f<T>(x: T, y: { [K in keyof T]: T[K] }): i64 { return 1; }
function main() {}
