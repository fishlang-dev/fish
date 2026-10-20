class Animal {}

function walk<A extends Animal>(a: A) {}

function main() {}
// error: a type parameter's bound must be an interface or an object type, not 'Animal'
