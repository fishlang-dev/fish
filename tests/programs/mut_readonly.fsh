type P = { readonly x: i64 }

function poke(m: Mut<P>) {
  m.x = 5
}

function main() {}
// error: cannot assign to 'x' because it is a read-only property
