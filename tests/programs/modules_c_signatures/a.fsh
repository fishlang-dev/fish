declare function labs(n: i64): i64;
export function a(): i64 { return unsafe { labs(-3) }; }
