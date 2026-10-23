// error: 'ReturnType' takes a function type, like 'ReturnType<() => i64>' or 'ReturnType<typeof f>', not 'string'
type R = ReturnType<string>;
function main() {}
