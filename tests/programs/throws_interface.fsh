// A throwing method can't stand in for an interface's.
interface M { m(): i64 }
class A { m(): i64 throws i64 { throw 3 } }
function g<T extends M>(x: T): i64 { return x.m() }
function main() { print(g(new A())) }
// error: method 'm' can throw, and an interface's methods can't declare errors yet
