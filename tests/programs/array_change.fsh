type P = { name: string; n: i64 };

function fill(xs: Mut<string[]>, k: i64) {
  for (let i = 0; i < k; i++) xs.push("w" + i);
}

class Stack {
  items: P[];
  constructor() {
    this.items = [];
  }
  add(this: Mut<this>, p: P) {
    this.items.push(p);
  }
}

function main() {
  let nums: i64[] = [];
  for (let i = 0; i < 10; i++) nums.push(i * i);
  nums[0] = 100;
  console.log(nums.length, nums[0], nums[9]);
  let words = ["a" + 1];
  fill(words, 5);
  words[1] = "x" + 9;
  console.log(words.length, words[0], words[1], words[5]);
  let people: P[] = [{ name: "ann" + 1, n: 1 }];
  people[0].name = "bo" + 2;
  people[0].n += 5;
  people.push({ name: "cy", n: 3 });
  console.log(people[0].name, people[0].n, people[1].name);
  let s = new Stack();
  s.add({ name: "z" + 1, n: 0 });
  console.log(s.items.length, s.items[0].name);
  let out = "";
  while (words.length > 0) {
    const w = words.pop();
    if (w !== null) out += w + ",";
  }
  console.log(out, words.length);
  people.pop();
  const gone = nums.pop();
  console.log(gone, people.length);
  let grid: i64[][] = [[1], [2, 3]];
  grid[1].push(4);
  grid.push([5]);
  console.log(grid[1][2], grid[2][0], grid.length);
}
// expect: 10 100 81
// expect: 6 a1 x9 w4
// expect: bo2 6 cy
// expect: 1 z1
// expect: w4,w3,w2,w1,x9,a1, 0
// expect: 81 1
// expect: 4 5 3
