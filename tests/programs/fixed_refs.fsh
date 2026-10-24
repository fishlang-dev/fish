// error: fixed arrays of references are not supported yet
function main() {
  const o = "o" + 1;
  let a: FixedArray<Ref<string>, 2> = [o, o];
  {
    const s = "x" + 1;
    a = [s, s];
  }
  console.log(a[0]);
}
