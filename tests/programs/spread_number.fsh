// error: '...' spreads an array, a string, a generator, a Map or a Set, not 'i64'
function main() { const n = 5; console.log([...n].length); }
