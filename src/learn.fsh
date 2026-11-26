// `fishc learn`: exercises that fail to compile until the ownership problem in them is fixed, each
// with the error it starts with, a hint, and a solution the unit tests check it against.

// An exercise: the file it is written to, what it teaches, the error code it fails with as given,
// a hint, its code as given, and a version that compiles.
export type Exercise = {
  file: string;
  title: string;
  why: string;
  error: string;
  hint: string;
  code: string;
  solved: string;
};

// The folder `fishc learn` writes the exercises to, in the directory it runs in.
export const FOLDER = "fish-learn";

export const EXERCISES: Exercise[] = [
  {
    file: "01_moves.fsh",
    title: "moves",
    why: "Passing an owned array to a function moves it there: `total` owns it now, and `scores` can't be used after the call.",
    error: "E0201",
    hint: "Have `total` borrow the array instead: take `xs: Ref<i64[]>`, and the caller keeps `scores`.",
    code: "function total(xs: i64[]): i64 {\n  let t = 0;\n  for (const x of xs) t += x;\n  return t;\n}\n\nfunction main() {\n  const scores = [3, 4, 5];\n  console.log(total(scores));\n  console.log(scores.length);\n}\n",
    solved:
      "function total(xs: Ref<i64[]>): i64 {\n  let t = 0;\n  for (const x of xs) t += x;\n  return t;\n}\n\nfunction main() {\n  const scores = [3, 4, 5];\n  console.log(total(scores));\n  console.log(scores.length);\n}\n",
  },
  {
    file: "02_clones.fsh",
    title: "clones",
    why: "`let kept = names` moves the array to `kept`, so `names` no longer holds one.",
    error: "E0201",
    hint: "Give `kept` a copy of its own with `names.clone()`; the two then change apart.",
    code: 'function main() {\n  let names = ["ana", "bo"];\n  let kept = names;\n  names.push("cy");\n  console.log(kept.length, names.length);\n}\n',
    solved:
      'function main() {\n  let names = ["ana", "bo"];\n  let kept = names.clone();\n  names.push("cy");\n  console.log(kept.length, names.length);\n}\n',
  },
  {
    file: "03_mutable_borrows.fsh",
    title: "mutable borrows",
    why: "A `Ref<T>` only reads. A function that changes what it borrows says so in its parameter's type.",
    error: "E0206",
    hint: "Take `list: Mut<string[]>`, a borrow that may change the array.",
    code: 'function addGuest(list: Ref<string[]>, name: string) {\n  list.push(name);\n}\n\nfunction main() {\n  let guests = ["ana"];\n  addGuest(guests, "bo");\n  console.log(guests.join(", "));\n}\n',
    solved:
      'function addGuest(list: Mut<string[]>, name: string) {\n  list.push(name);\n}\n\nfunction main() {\n  let guests = ["ana"];\n  addGuest(guests, "bo");\n  console.log(guests.join(", "));\n}\n',
  },
  {
    file: "04_borrows_in_loops.fsh",
    title: "borrows in loops",
    why: "A `for...of` loop borrows the array it reads, so nothing may change the array inside the loop.",
    error: "E0203",
    hint: "Loop over a copy: `for (const x of xs.clone())`.",
    code: "function main() {\n  let xs = [1, 2, 3];\n  for (const x of xs) {\n    if (x % 2 === 1) xs.push(x * 10);\n  }\n  console.log(xs.length);\n}\n",
    solved:
      "function main() {\n  let xs = [1, 2, 3];\n  for (const x of xs.clone()) {\n    if (x % 2 === 1) xs.push(x * 10);\n  }\n  console.log(xs.length);\n}\n",
  },
  {
    file: "05_constants.fsh",
    title: "constants",
    why: "`const` is deep: no field of a constant can be written.",
    error: "E0207",
    hint: "Declare `point` with `let`.",
    code: "function main() {\n  const point = { x: 1, y: 2 };\n  point.x = 5;\n  console.log(point.x + point.y);\n}\n",
    solved:
      "function main() {\n  let point = { x: 1, y: 2 };\n  point.x = 5;\n  console.log(point.x + point.y);\n}\n",
  },
  {
    file: "06_lifetimes.fsh",
    title: "lifetimes",
    why: "A function that returns one of several references has to say which of them the result may point into.",
    error: "E0209",
    hint: "Declare `<A extends Lifetime>` and write `Ref<string, A>` on both parameters and on the return type.",
    code: 'function longest(a: Ref<string>, b: Ref<string>): Ref<string> {\n  return a.length >= b.length ? a : b;\n}\n\nfunction main() {\n  const first = "fish";\n  const second = "lang!";\n  console.log(longest(first, second));\n}\n',
    solved:
      'function longest<A extends Lifetime>(a: Ref<string, A>, b: Ref<string, A>): Ref<string, A> {\n  return a.length >= b.length ? a : b;\n}\n\nfunction main() {\n  const first = "fish";\n  const second = "lang!";\n  console.log(longest(first, second));\n}\n',
  },
  {
    file: "07_option.fsh",
    title: "option",
    why: "`find` gives `string | null`. There is no truthiness to skip past the null: the type says it may be missing.",
    error: "E0502",
    hint: "Check `if (long !== null)` before calling a method on it.",
    code: 'function main() {\n  const words = ["sea", "salt", "shell"];\n  const long = words.find((w) => w.length > 4);\n  console.log(long.toUpperCase());\n}\n',
    solved:
      'function main() {\n  const words = ["sea", "salt", "shell"];\n  const long = words.find((w) => w.length > 4);\n  if (long !== null) console.log(long.toUpperCase());\n}\n',
  },
  {
    file: "08_fallbacks.fsh",
    title: "fallbacks",
    why: "`Map.get` gives `V | null`, since the key may be missing, and a `string` can't hold null.",
    error: "E0101",
    hint: "Fall back to a value with `??`: `names.get(who) ?? who`.",
    code: 'function nickname(names: Ref<Map<string, string>>, who: string): string {\n  return names.get(who);\n}\n\nfunction main() {\n  let names = new Map<string, string>();\n  names.set("robert", "bob");\n  console.log(nickname(names, "robert"), nickname(names, "alice"));\n}\n',
    solved:
      'function nickname(names: Ref<Map<string, string>>, who: string): string {\n  return names.get(who) ?? who;\n}\n\nfunction main() {\n  let names = new Map<string, string>();\n  names.set("robert", "bob");\n  console.log(nickname(names, "robert"), nickname(names, "alice"));\n}\n',
  },
  {
    file: "09_throws.fsh",
    title: "throws",
    why: "Errors are values. A function that throws says so in its type, and each caller handles the error or passes it on.",
    error: "E0602",
    hint: "Add `throws TooCold` after `main()`, or catch the error with try/catch.",
    code: 'class TooCold extends Error {}\n\nfunction brew(degrees: i64): string throws TooCold {\n  if (degrees < 90) throw new TooCold(`${degrees} is too cold`);\n  return "tea";\n}\n\nfunction main() {\n  console.log(brew(95));\n}\n',
    solved:
      'class TooCold extends Error {}\n\nfunction brew(degrees: i64): string throws TooCold {\n  if (degrees < 90) throw new TooCold(`${degrees} is too cold`);\n  return "tea";\n}\n\nfunction main() throws TooCold {\n  console.log(brew(95));\n}\n',
  },
  {
    file: "10_booleans.fsh",
    title: "booleans",
    why: "A condition must be a boolean: a number is never true or false by itself.",
    error: "E0102",
    hint: "Compare it: `queue.length > 0`.",
    code: 'function main() {\n  const queue: string[] = [];\n  if (queue.length) console.log("busy");\n  else console.log("empty");\n}\n',
    solved:
      'function main() {\n  const queue: string[] = [];\n  if (queue.length > 0) console.log("busy");\n  else console.log("empty");\n}\n',
  },
  {
    file: "11_numbers.fsh",
    title: "numbers",
    why: "Numbers have sizes, and two different ones never mix without saying so.",
    error: "E0111",
    hint: "Convert one side: `(items as f64) * price`.",
    code: "function main() {\n  const items: i64 = 3;\n  const price: f64 = 2.5;\n  console.log(items * price);\n}\n",
    solved:
      "function main() {\n  const items: i64 = 3;\n  const price: f64 = 2.5;\n  console.log((items as f64) * price);\n}\n",
  },
  {
    file: "12_methods.fsh",
    title: "methods",
    why: "A method borrows `this` read-only unless its signature says it changes it.",
    error: "E0206",
    hint: "Declare it as `bump(this: Mut<this>)`.",
    code: "class Counter {\n  count: i64 = 0;\n  bump() {\n    this.count += 1;\n  }\n}\n\nfunction main() {\n  let c = new Counter();\n  c.bump();\n  c.bump();\n  console.log(c.count);\n}\n",
    solved:
      "class Counter {\n  count: i64 = 0;\n  bump(this: Mut<this>) {\n    this.count += 1;\n  }\n}\n\nfunction main() {\n  let c = new Counter();\n  c.bump();\n  c.bump();\n  console.log(c.count);\n}\n",
  },
  {
    file: "13_match.fsh",
    title: "match",
    why: "A `match` has to cover every value it can be given.",
    error: "E0607",
    hint: "Add `case Light.Amber => Light.Red`.",
    code: "enum Light { Red, Amber, Green }\n\nfunction next(l: Light): Light {\n  return match (l) {\n    case Light.Red => Light.Green,\n    case Light.Green => Light.Amber,\n  };\n}\n\nfunction main() {\n  console.log(next(Light.Red) === Light.Green);\n}\n",
    solved:
      "enum Light { Red, Amber, Green }\n\nfunction next(l: Light): Light {\n  return match (l) {\n    case Light.Red => Light.Green,\n    case Light.Green => Light.Amber,\n    case Light.Amber => Light.Red,\n  };\n}\n\nfunction main() {\n  console.log(next(Light.Red) === Light.Green);\n}\n",
  },
  {
    file: "14_shared_state.fsh",
    title: "shared state",
    why: "A spawned task works on its own copy of what it captures, so a change it makes would be lost.",
    error: "E0210",
    hint: "Keep the count in an `Atomic` inside `shared({ count: new Atomic(0) })`, give each task its own `hits.clone()`, and read it with `.count.load()`.",
    code: "async function main(): Promise<void> {\n  let hits = 0;\n  let tasks: JoinHandle<void>[] = [];\n  for (let i = 0; i < 4; i++) tasks.push(spawn(async () => { hits += 1; }));\n  while (tasks.length > 0) {\n    const t = tasks.pop()!;\n    await t;\n  }\n  console.log(hits);\n}\n",
    solved:
      "async function main(): Promise<void> {\n  const hits = shared({ count: new Atomic(0) });\n  let tasks: JoinHandle<void>[] = [];\n  for (let i = 0; i < 4; i++) {\n    const mine = hits.clone();\n    tasks.push(spawn(async () => { mine.count.add(1); }));\n  }\n  while (tasks.length > 0) {\n    const t = tasks.pop()!;\n    await t;\n  }\n  console.log(hits.count.load());\n}\n",
  },
  {
    file: "15_arrays_own_their_elements.fsh",
    title: "arrays own their elements",
    why: "An array owns its elements. Taking an object out by index would leave a hole, so it can't be moved out.",
    error: "E0202",
    hint: "Borrow it, `const first: Ref<Point> = points[0];`, or take a copy with `.clone()`.",
    code: "type Point = { x: i64; y: i64 };\n\nfunction main() {\n  let points: Point[] = [{ x: 1, y: 2 }, { x: 3, y: 4 }];\n  const first = points[0];\n  console.log(first.x, points.length);\n}\n",
    solved:
      "type Point = { x: i64; y: i64 };\n\nfunction main() {\n  let points: Point[] = [{ x: 1, y: 2 }, { x: 3, y: 4 }];\n  const first: Ref<Point> = points[0];\n  console.log(first.x, points.length);\n}\n",
  },
];

// An exercise's file as written to the folder: what it teaches and how to go on, then its code.
export function exerciseText(n: usize, e: Ref<Exercise>): string {
  return `// Exercise ${n + 1} of ${EXERCISES.length}: ${e.title}\n//\n// ${e.why}\n//\n// Make it compile, keeping what it prints. Stuck? Run 'fishc learn hint'.\n\n${e.code}`;
}
