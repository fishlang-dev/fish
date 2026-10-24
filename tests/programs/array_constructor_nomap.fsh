// error: 'Array.from({ length: n })' alone would hold n undefined values, which Fish has no way to make; give it a function, as in 'Array.from({ length: n }, (_, i) => i)'
function main() { console.log(Array.from({ length: 3 }).length); }
