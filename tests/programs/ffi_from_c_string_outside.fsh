function main() {
  const p = cString("a");
  console.log(fromCString(p));
}
// error: 'fromCString' can only happen inside 'unsafe { }'
