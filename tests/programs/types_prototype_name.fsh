// error: cannot find type 'toString'
// A type name that is also a JavaScript object member is still just an unknown name.
function main() { let y: toString = 1; let z: Partial<{ a: i64 }> = {}; }
