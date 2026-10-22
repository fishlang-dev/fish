// error: a stored 'Promise<i64>' may be awaited on any thread, so its future can't hold a 'Ref<string>'
async function size(s: Ref<string>): Promise<i64> {
  return s.length as i64;
}

async function main() {
  const s = "abc" + "";
  const p: Promise<i64> = size(s);
  const n = await p;
}
