type P = { x: i64 }
type H = { m: Mut<P> }

function w(h: Ref<H>) {
  h.m.x = 7
}

function main() {}
// error: cannot assign to 'h.m.x' because 'h' is a shared reference ('Ref'), which only reads
