// error: 'shared' has no method 'set'; read its fields, change it with 'update', or share it again with 'clone'
function main() {
  const s = shared(1);
  s.set(2);
}
