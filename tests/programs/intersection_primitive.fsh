type Id = i64 & { __brand: "Id" }

function main() {}
// error: intersections with primitive types are not supported yet
