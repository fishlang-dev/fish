// error: 'N' is a top-level const, computed while compiling, so it never changes
// A top-level const can't be assigned to.
const N = 3;
function main() { N = 4; }
