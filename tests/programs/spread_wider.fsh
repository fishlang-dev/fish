// error: type 'string' is not assignable to type 'i64'
function main() { const xs = ["a"]; const ys: i64[] = [...xs]; }
