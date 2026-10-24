// error: a closure with default parameter values can't be stored as a value yet, since calls through it pass every argument; give the parameters no defaults
function main() { const o = { f: (x: i64 = 1) => x }; console.log(o.f(null)); }
