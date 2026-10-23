declare function labs(n: i32): i32;
export function b(): i32 { return unsafe { labs(-4 as i32) }; }
