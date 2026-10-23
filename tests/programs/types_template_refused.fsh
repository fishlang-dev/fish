// error: type '"c-1"' is not assignable to type
type Ids = `${"a" | "b"}-${1 | 2}`;
function main() { const x: Ids = "c-1"; }
