// error: 'Array.from' makes an array from an array, a string, a generator or '{ length: n }', not 'i64'
function main() { console.log(Array.from(5).length); }
