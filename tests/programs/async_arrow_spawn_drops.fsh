// expect: 1
async function main() {
  const s2 = "s" + "";
  const f = async () => s2.length as i64;
  const t = spawn(f());
  const got = await t;
  console.log(got);
}
