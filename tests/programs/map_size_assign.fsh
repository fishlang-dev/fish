// error: a Map's or a Set's 'size' can't be set; use 'delete' or 'clear' to remove entries
function main() { let m = new Map<string, i64>(); m.size = 3; }
