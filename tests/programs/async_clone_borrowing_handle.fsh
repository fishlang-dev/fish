// expect: 7
// expect: v1
async function one(n: i64): Promise<string> { await yieldNow(); return "v" + n; }
function look(h: Ref<JoinHandle<string>>): i64 { return 7; }
async function main() {
  const h = spawn(one(1));
  const f = () => look(h);
  const g = f.clone();
  console.log(g());
  const v = await h;
  console.log(v);
}
