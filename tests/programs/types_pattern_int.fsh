// error: type '"id-1.5"' is not assignable to type '`id-${i64}`'
type Id = `id-${i64}`;
function main() { const x: Id = "id-1.5"; }
