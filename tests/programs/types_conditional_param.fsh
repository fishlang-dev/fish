// error: a conditional type of the type parameter 'T' isn't supported yet
// Inside generic function code, a conditional over the function's own type parameter can't be
// computed, since T is only known per instance.
function first<T>(x: T extends null ? never : T): i64 { return 1; }
function main() {}
