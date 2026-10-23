// error: unions holding 'infer' are not supported yet
type U<T> = T extends (infer U) | null ? U : "no";
type X = U<i64>;
function main() {}
