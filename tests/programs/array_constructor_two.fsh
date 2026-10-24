// error: 'new Array(a, b)' makes an array of its arguments; write 'Array.of(a, b)' or '[a, b]'
function main() { const xs = new Array(1, 2); }
