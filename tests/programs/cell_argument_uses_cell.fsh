// expect: a
function main() {
  const c = new Cell<string>("a" + "");
  c.set(c.replace("b" + ""));
  console.log(c.replace("z"));
}
