// Fish's built-in types, as TypeScript sees them, so the compiler's source can be written as Fish
// reads it and still run under tsc and Bun: every number type is a plain `number`, so an `as`
// between them is a no-op, and a borrow is the value it borrows. Fish never reads this file.
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
type Lifetime = unknown;
type Ref<T, L extends Lifetime = Lifetime> = T;
type Mut<T, L extends Lifetime = Lifetime> = T;
