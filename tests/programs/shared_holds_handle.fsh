// error: a 'shared' value can't hold a JoinHandle
async function f(): Promise<string> { return "res" + "ult"; }
async function main() {
  const st = shared({ h: spawn(f()), n: 1 });
  const a = st.h;
  const b = st.h;
  const x = await a;
  const y = await b;
  console.log(x, y);
}
