// The study's tasks: small Rust programs, each translated by hand into Fish with the mistake a
// TypeScript developer makes first left in, so the participant meets a real ownership error and
// fixes it. `solution` is the translation that compiles, shown on giving up; `expect` is what it
// prints.
export type Task = { id: string; title: string; goal: string; rust: string; fish: string; solution: string; expect: string };

export const TASKS: Task[] = [
  {
    id: "lend",
    title: "Lend instead of handing over",
    goal: "Sum the numbers without giving the array away, then print the sum and how many there were.",
    rust: `fn sum(v: &Vec<i64>) -> i64 {
    v.iter().sum()
}

fn main() {
    let v = vec![3, 4, 5];
    let total = sum(&v);
    println!("{} {}", total, v.len());
}
`,
    fish: `export function sum(v: i64[]): i64 {
  let total = 0;
  for (const x of v) total += x;
  return total;
}

function main() {
  const v = [3, 4, 5];
  const total = sum(v);
  console.log(total, v.length);
}
`,
    solution: `export function sum(v: Ref<i64[]>): i64 {
  let total = 0;
  for (const x of v) total += x;
  return total;
}

function main() {
  const v = [3, 4, 5];
  const total = sum(v);
  console.log(total, v.length);
}
`,
    expect: "12 3",
  },
  {
    id: "mutate",
    title: "Say when a function changes its argument",
    goal: "Add two items to the list in a helper function, then print the list's length.",
    rust: `fn push_twice(v: &mut Vec<String>) {
    v.push("a".to_string());
    v.push("b".to_string());
}

fn main() {
    let mut v = Vec::new();
    push_twice(&mut v);
    println!("{}", v.len());
}
`,
    fish: `function pushTwice(v: Ref<string[]>) {
  v.push("a");
  v.push("b");
}

function main() {
  let v: string[] = [];
  pushTwice(v);
  console.log(v.length);
}
`,
    solution: `function pushTwice(v: Mut<string[]>) {
  v.push("a");
  v.push("b");
}

function main() {
  let v: string[] = [];
  pushTwice(v);
  console.log(v.length);
}
`,
    expect: "2",
  },
  {
    id: "method",
    title: "A method that changes its object",
    goal: "Count three clicks with the counter's method and print the count.",
    rust: `struct Counter {
    count: i64,
}

impl Counter {
    fn click(&mut self) {
        self.count += 1;
    }
}

fn main() {
    let mut c = Counter { count: 0 };
    c.click();
    c.click();
    c.click();
    println!("{}", c.count);
}
`,
    fish: `class Counter {
  count = 0;

  click() {
    this.count += 1;
  }
}

function main() {
  let c = new Counter();
  c.click();
  c.click();
  c.click();
  console.log(c.count);
}
`,
    solution: `class Counter {
  count = 0;

  click(this: Mut<this>) {
    this.count += 1;
  }
}

function main() {
  let c = new Counter();
  c.click();
  c.click();
  c.click();
  console.log(c.count);
}
`,
    expect: "3",
  },
  {
    id: "clone",
    title: "Keep a copy",
    goal: "Give one list of names to a team and keep using the original, then print both sizes.",
    rust: `struct Team {
    names: Vec<String>,
}

fn main() {
    let names = vec!["ann".to_string(), "bo".to_string()];
    let team = Team { names: names.clone() };
    println!("{} {}", team.names.len(), names.len());
}
`,
    fish: `type Team = { names: string[] };

function main() {
  const names = ["ann", "bo"];
  const team: Team = { names: names };
  console.log(team.names.length, names.length);
}
`,
    solution: `type Team = { names: string[] };

function main() {
  const names = ["ann", "bo"];
  const team: Team = { names: names.clone() };
  console.log(team.names.length, names.length);
}
`,
    expect: "2 2",
  },
];
