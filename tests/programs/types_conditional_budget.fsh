// error: is one of more than 20000 alias instances computed while compiling
// A conditional type that branches as it recurses grows exponentially, so it is stopped.
type B<T, U> = T extends (infer E)[] ? B<E, { l: U }> | B<E, { r: U }> : U;
type R = B<i64[][][][][][][][][][][][][][][][][][][][], i64>;
function main() {}
