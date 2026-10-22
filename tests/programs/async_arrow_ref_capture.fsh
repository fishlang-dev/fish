// error: cannot move 's' while 'p' borrows 's'
function consume(xs: string[]): i64 { return xs.length as i64; }
async function main() {
  const s = ["abc" + "", "def" + ""];
  const r: Ref<string[]> = s;
  const f = async () => {
    return r[0] + r[1];
  };
  const p = f();
  const n = consume(s);
  const v = await p;
  console.log(v, n);
}
