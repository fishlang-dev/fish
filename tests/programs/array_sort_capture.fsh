// error: cannot change 'xs' while 'xs' is lent to 'sort' for this call
function main() { let xs = [2, 1]; xs.sort((a, b) => a - b + (xs.length as i64)); console.log(xs[0]); }
