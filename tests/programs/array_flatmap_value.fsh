// error: 'flatMap''s callback gives an array for each element
function main() { const xs = [1]; console.log(xs.flatMap((x) => x).length); }
