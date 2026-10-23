// error: cannot change 'xs' while a 'for...of' loop borrows 'xs' and is used later
function main() { let xs = [1, 2]; for (const [i, x] of xs.entries()) { xs.push(x); } }
