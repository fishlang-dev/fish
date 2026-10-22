// error: this async function captures 'holder', which holds an Atomic
// Each call of an async callable works on a copy of its captures, so an Atomic can't be one.
type Fn = () => Promise<i64>;
async function main(): Promise<void> {
  const holder = { n: new Atomic(0) };
  const f: Fn = async () => holder.n.add(1);
  const a = await f();
}
