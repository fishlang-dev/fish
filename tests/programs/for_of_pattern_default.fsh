// error: defaults in destructuring patterns are not supported yet
function main() { const ps = [{ x: 1 }]; for (const { x = 5 } of ps) console.log(x); }
