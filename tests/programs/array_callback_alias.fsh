// error: cannot mutably lend 'xs' while 'xs' is lent to 'map' for this call
function main() { let xs = [1, 2]; const ys = xs.map((x) => { xs.push(x); return x; }); console.log(ys.length); }
