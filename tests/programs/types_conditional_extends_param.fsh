// error: a conditional type of the type parameter 'T' isn't supported yet
// A type parameter on the extends side would decide the branch once for every instance.
function f<T>(x: T, y: string extends T ? i64 : boolean): i64 { return 1; }
function main() {}
