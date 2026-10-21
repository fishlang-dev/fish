function main() {
  let n = 3;
  const lim: u8 = 3;
  switch (n) {
    case lim:
      console.log("three");
      break;
    default:
      console.log("other");
  }
  let m = 0;
  const g = () => {
    const v: u16 = m;
    return v + 1;
  };
  console.log(g());
}
// expect: three
// expect: 1
