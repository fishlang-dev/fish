// Fish's number types, as TypeScript sees them: the compiler's source names its numbers as Fish
// does, and under tsc and Bun every one is a plain `number`, so an `as` between them is a no-op.
// Fish has these built in and never reads this file.
type i8 = number;
type i16 = number;
type i32 = number;
type i64 = number;
type i128 = number;
type isize = number;
type u8 = number;
type u16 = number;
type u32 = number;
type u64 = number;
type u128 = number;
type usize = number;
type f32 = number;
type f64 = number;
