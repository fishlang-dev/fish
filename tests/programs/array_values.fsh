type P = { name: string; n: i64 };

class Bag {
  items: string[];
  constructor(items: string[]) {
    this.items = items;
  }
}

function make(k: i64): string[] {
  return ["a" + k, "b" + k, "c"];
}

function total(xs: i64[]): i64 {
  let t = 0;
  for (let i = 0; i < xs.length; i++) t += xs[i];
  return t;
}

function main() {
  const nums = [1, 2, 3];
  const small: u8[] = [7, 8];
  const words = make(1);
  const people: P[] = [{ name: "ann" + 1, n: 1 }, { name: "bo", n: 2 }];
  const grid = [[1, 2], [3, 4, 5]];
  const mixed = [1, "x" + 2];
  const empty: string[] = [];
  console.log(nums.length, nums[2], small[1], words[0], words[2], people[1].name, people[0].name, grid[1][2], grid.length);
  console.log(total(nums), total([10, 20]), empty.length, make(2)[1], words.length);
  const maybe: string[] | null = make(3);
  if (maybe !== null) console.log(maybe[0]);
  const bag = new Bag(make(4));
  console.log(bag.items[1], bag.items.length);
  const m = mixed[1];
  if (typeof m === "string") console.log(m);
  const copy = words[1];
  console.log(copy);
}
// expect: 3 3 8 a1 c bo ann1 5 2
// expect: 6 30 0 b2 3
// expect: a3
// expect: b4 3
// expect: x2
// expect: b1
