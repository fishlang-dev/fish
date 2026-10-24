// error: 'new Array(n)' would hold n empty slots, which Fish has no way to make; fill it, as in 'new Array(n).fill(0)', or use 'Array.from({ length: n }, (_, i) => ...)'
function main() { const xs = new Array(3); }
