function* words(xs: string[]): Generator<string> {
  for (const x of xs) yield x + "!";
}
function f(o: { state: i32 }): i32 { return o.state; }
function main() {
  let g = words(["a" + 1]);
  g.next();
  console.log(f(g));
}
// error: argument of type 'Generator<string>' is not assignable to parameter of type '{ state: i32 }'
