// error: 'infer V' matched nothing in '{ w: i64 }', since the optional field holding it is missing
type V = string;
type F<T> = T extends { v?: infer V } ? V : i64;
type X = F<{ w: i64 }>;
function main() {}
