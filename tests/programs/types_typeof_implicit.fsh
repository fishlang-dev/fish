// expect: 8080 ok
// 'typeof' names a function taking an object type or a borrow with a lifetime by its declared
// signature, though Fish compiles it per argument type.
type Config = { port: i64; name: string };
function portOf(c: Config): i64 { return c.port; }
function pick<A extends Lifetime>(x: Ref<string, A>, y: Ref<string>): Ref<string, A> { return x; }
type Port = ReturnType<typeof portOf>;
type Picked = ReturnType<typeof pick>;
function main() { const p: Port = portOf({ port: 8080, name: "a" }); const s = "ok"; const t = "no"; const q: Picked = pick(s, t); console.log(p, q); }
