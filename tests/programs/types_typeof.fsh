// expect: hi 6 4 dev
// `typeof` in a type names a top-level function's or const's type, so ReturnType, Awaited and
// parameters can follow them.
type Config = { port: i64; name: string };
const CONFIG: Config = { port: 8080, name: "dev" };
function greet(n: i64): string { return "hi"; }
function double(n: i64) { return n * 2; }
async function fetchCount(): Promise<i64> { return 4; }
type Greeting = ReturnType<typeof greet>;
type Doubled = ReturnType<typeof double>;
type Count = Awaited<ReturnType<typeof fetchCount>>;
function show(c: Ref<typeof CONFIG>): string { return c.name; }
async function main() {
  const g: Greeting = greet(1);
  const d: Doubled = double(3);
  const c: Count = await fetchCount();
  console.log(g, d, c, show(CONFIG));
}
