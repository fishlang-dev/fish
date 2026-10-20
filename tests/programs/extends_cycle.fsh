class A extends B {}
class B extends A {}

function main() {}
// error: embeds itself through 'extends'
