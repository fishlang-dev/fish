// error: cannot reserve 'xs' because 'xs' is a shared reference ('Ref'), which only reads
function f(xs: Ref<i64[]>) { xs.reserve(1); }
function main() { let xs = [1]; f(xs); }
