// error: cannot reserve 'xs' because it is a constant
function main() { const xs = [1]; xs.reserve(4); }
