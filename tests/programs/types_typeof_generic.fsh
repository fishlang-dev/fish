// error: 'typeof' of the generic function 'id' isn't supported yet
function id<T>(x: T): T { return x; }
type R = ReturnType<typeof id>;
function main() {}
