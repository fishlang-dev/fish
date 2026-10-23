// error: cannot assign to 'born' because it is a read-only property
type User = { id: i64; born: i64 };
type MyReadonly<T> = { readonly [K in keyof T]: T[K] };
function main() { let u: MyReadonly<User> = { id: 1, born: 2 }; u.born = 3; }
