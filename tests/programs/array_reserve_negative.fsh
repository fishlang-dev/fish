// panic: capacity overflow
function main() { let xs = [1]; xs.reserve(-1); }
