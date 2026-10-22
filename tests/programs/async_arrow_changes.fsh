// error: this async arrow changes 'n', which it captured
async function main() {
  let arr = [1, 2, 3];
  const f = () => {
    arr.push(4);
    return arr.length;
  };
  const a = f();
  const b = f();
  console.log(a, b);
  let n = 0;
  const g = async () => {
    n += 1;
    return n;
  };
  const c = await g();
  const d = await g();
  console.log(c, d, n);
}
