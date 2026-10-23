// expect: 4 8
// Names outside ASCII are valid variable and parameter names.
function twice(naïve: i64): i64 { return naïve * 2; }
function main() { const café = 1; const π = 3; console.log(café + π, twice(4)); }
