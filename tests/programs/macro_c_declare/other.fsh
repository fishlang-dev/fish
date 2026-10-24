declare function labs(x: i64): i64;
export function viaOther(): i64 { return unsafe { labs(-2) }; }
