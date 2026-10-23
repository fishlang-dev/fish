// error: 'typeof make' is used in working out make's own type, so that type would depend on itself
function make(x: typeof make): i64 { return 1; }
function main() {}
