// error: rest parameters other than '...args: any[]' in an 'infer' pattern, which need tuple types, are not supported yet
type Params<F> = F extends (...args: infer P) => i64 ? P : never;
type X = Params<() => i64>;
function main() {}
