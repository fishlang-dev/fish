type O = { tags: string[][] };
function main() {
  let o: O = { tags: [["t" + 1], ["u" + 2]] };
  const r: Ref<O> = o;
  for (const t of r.tags) {
    o = { tags: [] };
    console.log(t.length);
  }
}
// error: cannot change 'o' while a 'for...of' loop and 't' borrow 'o'
