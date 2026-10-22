async function main() {
  const s = "ww" + 1;
  const r: Ref<i64 | string> = s;
  await yieldNow();
  if (typeof r === "string") console.log("str", r);
}
// error: references that convert their value inside async functions are not supported yet
