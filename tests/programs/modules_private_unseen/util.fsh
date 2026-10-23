function secret(): i64 { return 1; }
export function open(): i64 { return secret(); }
