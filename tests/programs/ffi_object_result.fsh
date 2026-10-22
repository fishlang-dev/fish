type P = { x: i64 };
declare function make(): P;

function main() {}
// error: a C function can't return a '{ x: i64 }'; C gives numbers, booleans and raw pointers
