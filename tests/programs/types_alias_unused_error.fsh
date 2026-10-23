// error: cannot find type 'Nope'
// An unused generic alias is still checked past the type functions it can't compute yet.
type Bad<T> = Partial<T> | Nope;
function main() {}
