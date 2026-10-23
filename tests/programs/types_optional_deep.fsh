// expect: 1
// Nested optional fields and unions compile in linear time, not exponential.
type T0 = { a?: i64; s: string | i64 };
type T1 = { x?: T0 | string; y: T0 | i64 | boolean };
type T2 = { x?: T1 | string; y: T1 | i64 | boolean };
type T3 = { x?: T2 | string; y: T2 | i64 | boolean };
type T4 = { x?: T3 | string; y: T3 | i64 | boolean };
type T5 = { x?: T4 | string; y: T4 | i64 | boolean };
type T6 = { x?: T5 | string; y: T5 | i64 | boolean };
type T7 = { x?: T6 | string; y: T6 | i64 | boolean };
type T8 = { x?: T7 | string; y: T7 | i64 | boolean };
type T9 = { x?: T8 | string; y: T8 | i64 | boolean };
type T10 = { x?: T9 | string; y: T9 | i64 | boolean };
type T11 = { x?: T10 | string; y: T10 | i64 | boolean };
type T12 = { x?: T11 | string; y: T11 | i64 | boolean };
type T13 = { x?: T12 | string; y: T12 | i64 | boolean };
type T14 = { x?: T13 | string; y: T13 | i64 | boolean };
function f(t: T14): i64 { return 1; }
function main() { console.log(1); }
