function main() {
  const xs = [{ n: 1 }];
  xs[0].n = 2;
}
// error: cannot assign to 'xs[...].n' because 'xs' is a constant
