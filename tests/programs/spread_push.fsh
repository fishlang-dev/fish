// error: '...' spreads into an array literal, or as an argument into a rest parameter
function main() { let xs = [1]; const ys = [2, 3]; xs.push(...ys); }
