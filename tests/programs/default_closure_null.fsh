// error: this parameter has a default, so it takes a value, not null or an Option; leave the argument out to use the default
function main() { const a = (x: i64 = 1) => x; console.log(a(null)); }
