// error: cannot shrinkToFit 'xs' because 'xs' is a shared reference ('Ref'), which only reads
function f(xs: Ref<i64[]>) { xs.shrinkToFit(); }
function main() { let xs = [1]; f(xs); }
