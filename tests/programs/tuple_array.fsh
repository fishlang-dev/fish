// expect: 1 2
// An array pattern over an array of copies reads each element.
function main() { const xs = [1, 2]; const [a, b] = xs; console.log(a, b); }
