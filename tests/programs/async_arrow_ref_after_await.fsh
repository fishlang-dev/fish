// expect: abc!
async function main() {
  const s = "abc" + "";
  const r: Ref<string> = s;
  const f = async () => {
    await yieldNow();
    return r + "!";
  };
  const v = await f();
  console.log(v);
}
