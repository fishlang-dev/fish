// error: 'typeof' in a type names a top-level function or const, and there is none named 'nope'
type R = typeof nope;
function main() {}
