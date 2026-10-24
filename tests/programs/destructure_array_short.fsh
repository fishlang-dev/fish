// panic: index out of bounds: the len is 2 but the index is 2
function main() { const [a, b, c] = "x,y".split(","); console.log(a, b, c); }
