// error: two keys of this mapped type are both renamed 'same'
type Clash = { [K in "a" | "b" as "same"]: i64 };
function main() {}
