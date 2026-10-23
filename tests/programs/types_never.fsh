// expect: 1
// `never` drops out of a union, and Exclude of every member is `never`, which no value has.
type Same = Exclude<"a", "a"> | i64;
function main() { const x: Same = 1; console.log(x); }
