// Nor through an interface declaring it writable.
interface HasId { id: i64 }
class Account { readonly id: i64 = 1 }
function forge(x: Mut<HasId>) { x.id = 999 }
function main() { let b = new Account(); forge(b); print(b.id) }
// error: 'id' is read-only here, but 'forge' takes it mutably as 'HasId', which could change it
