declare function strlen(s: Ptr<u8>): usize;
async function main() {
  const p = cString("hello" + 1);
  await yieldNow();
  const n = unsafe { strlen(p) };
  console.log(n);
}
// error: 'cString' inside async functions are not supported yet
