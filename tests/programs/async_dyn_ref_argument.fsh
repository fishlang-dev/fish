// error: cannot move 's' while 'f' borrows 's[...]'
interface H { h(x: Ref<string>): Promise<string>; }
class C {
  async h(x: Ref<string>): Promise<string> {
    await yieldNow();
    return x + "!";
  }
}
function consume(xs: string[]): i64 { return xs.length as i64; }
async function main() {
  const d: Dyn<H> = new C();
  let s = ["abc" + "x", "def" + "y"];
  const f = d.h(s[1]);
  const n = consume(s);
  const v = await f;
  console.log(v, n);
}
