function main() {
  let xs = [1, 2];
  for (const x of xs) xs.push(x);
}
// error: cannot change 'xs' while a 'for...of' loop is reading 'xs'
