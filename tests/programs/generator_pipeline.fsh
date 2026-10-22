function* count(n: i64): Generator<i64> {
  for (let i = 0; i < n; i++) yield i;
}

function* evens(n: i64): Generator<i64> {
  for (let i = 0; i < n; i += 2) yield i;
}

function* label(prefix: string, n: i64): Generator<string> {
  for (const i of count(n)) yield prefix + i;
}

function* both(n: i64): Generator<string> {
  yield* label("a", n);
  yield "middle";
  yield* label("b" + n, 1);
  yield* ["x" + 1, "y"];
}

function sum(g: Generator<i64>): i64 {
  let total = 0;
  for (const v of g) total += v;
  return total;
}

function firstTwo(g: Mut<Generator<i64>>): i64 {
  const a = g.next();
  const b = g.next();
  if (a.done === false && b.done === false) return a.value * 10 + b.value;
  return -1;
}

function join(g: Generator<string>): string {
  let out = "";
  for (const s of g) out += s + ",";
  return out;
}

function main() {
  console.log(sum(count(5)), sum(evens(7)));
  let g = count(10);
  console.log(firstTwo(g), firstTwo(g));
  const rest = g.next();
  if (rest.done === false) console.log("then", rest.value);
  console.log(join(label("n", 3)));
  console.log(join(both(2)));
}
// expect: 10 12
// expect: 1 23
// expect: then 4
// expect: n0,n1,n2,
// expect: a0,a1,middle,b20,x1,y,
