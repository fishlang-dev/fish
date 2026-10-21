function n<T>(xs: Ref<T[]>): usize { return xs.length; }
function firstOf<T>(xs: Array<T>): usize { return xs.length; }
function main() {
  const a = ["x", "y"];
  console.log(n(a), firstOf([1, 2, 3]));
}
// expect: 2 3
