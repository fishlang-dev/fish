function main() {
  const r: Ref<string> = "tmp" + 1;
  console.log(r);
}
// error: 'r' would keep borrowing this temporary
