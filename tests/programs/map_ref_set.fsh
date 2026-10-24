// error: cannot add to 'm' because 'm' is a shared reference ('Ref'), which only reads
function f(m: Ref<Map<string, i64>>) { m.set("a", 1); } function main() {}
