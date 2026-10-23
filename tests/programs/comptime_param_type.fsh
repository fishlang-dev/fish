// error: a comptime parameter takes an integer, a boolean, a string, an enum member or a string array, not 'i64[]'
// A comptime parameter's values must compare, to make one instance per value.
function sum(comptime xs: i64[]): i64 { return 0; }
function main() { console.log(sum([1])); }
