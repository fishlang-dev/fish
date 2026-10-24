// error: 'new Map' takes an array of key and value pairs, as in 'new Map([["a", 1]])', not 'i64[]'
function main() { const m = new Map([1, 2]); }
