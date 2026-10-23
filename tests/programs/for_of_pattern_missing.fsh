// error: property 'z' does not exist on type '{ x: i64 }'
function main() { const ps = [{ x: 1 }]; for (const { z } of ps) console.log(z); }
