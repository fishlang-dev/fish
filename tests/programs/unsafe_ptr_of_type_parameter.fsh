function at<T>(x: T): Ptr<T> { return ptrOf(x); }
function main() { const n = 5; const p = at(n); }
// error: 'ptrOf' calls on values whose type is a type parameter are not supported yet
