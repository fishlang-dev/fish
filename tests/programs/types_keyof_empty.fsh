// error: '{}' has no public fields, so 'keyof' of it has no keys
type K = keyof {};
function main() {}
