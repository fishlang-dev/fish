// expect: 0 7
// An async function's written Promise<T> is its type, so a class's own fields may name it.
class Holder { w: i64 = 7; v: Awaited<ReturnType<typeof make>>; constructor() { this.v = 0; } }
async function make(): Promise<i64> { const h = new Holder(); return h.w; }
async function main() { const h = new Holder(); const m = await make(); console.log(h.v, m); }
