// error: cannot splice 'xs' because it is a constant
function main() { const xs = [1, 2]; xs.splice(0, 1); }
