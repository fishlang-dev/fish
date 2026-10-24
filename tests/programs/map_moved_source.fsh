// error: 'xs.length' can't be used here because 'xs' was moved
function main() { let xs = ["a", "b"]; const s = new Set(xs); console.log(xs.length); }
