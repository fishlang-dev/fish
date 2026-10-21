type P = { name: string; n: i64 };

function sum(xs: readonly i64[]): i64 {
  let t = 0;
  for (let i = 0; i < xs.length; i++) t += xs[i];
  return t;
}

function rename(p: Mut<P>, to: string) {
  p.name = to;
}

function first(xs: Ref<P[]>): string {
  return xs[0].name;
}

function main() {
  let people: P[] = [{ name: "ann" + 1, n: 1 }, { name: "bo", n: 2 }];
  rename(people[1], "cy" + 3);
  const copy = people.clone();
  people[0].name = "zed";
  console.log(people[0].name, copy[0].name, copy[1].name, first(people), people[1].name);
  const nums = [1, 2, 3];
  console.log(sum(nums), nums.length);
  const moved = people;
  console.log(moved.length, moved[1].n);
  const name = moved[0].name;
  const n = moved[1].n;
  console.log(name, n);
}
// expect: zed ann1 cy3 zed cy3
// expect: 6 3
// expect: 2 2
// expect: zed 2
