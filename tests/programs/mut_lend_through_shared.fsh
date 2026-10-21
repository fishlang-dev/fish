type P = { x: i64 }
type H = { m: Mut<P> }

function poke(m: Mut<P>) {
  m.x = 4
}

function w(a: Ref<H>) {
  poke(a.m)
}

function main() {}
// error: cannot mutably borrow 'a.m' because 'a' is a shared reference ('Ref'), which only reads
