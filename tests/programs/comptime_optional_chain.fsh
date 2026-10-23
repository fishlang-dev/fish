// expect: -1
// expect: -1
// expect: -1
// expect: -1
// expect: -1
// An optional chain on an empty Option is empty at comptime too, running nothing after it.
type In = { c: i64 };
type Out = { b: In };
class K {
  v: i64;
  constructor(v: i64) { this.v = v; }
  get twice(): i64 { return this.v * 2; }
  m(): i64 { return 42; }
  n(): i64 { return this.v; }
}
function chain(): string {
  const o: Out | null = null;
  const k: K | null = null;
  return `${o?.b.c ?? -1}`;
}
function call(): string {
  const k: K | null = null;
  return `${k?.m() ?? -1}`;
}
function call2(): string {
  const k: K | null = null;
  return `${k?.n() ?? -1}`;
}
function getter(): string {
  const k: K | null = null;
  return `${k?.twice ?? -1}`;
}
function main() {
  console.log(chain());

  console.log(call());
  console.log(comptime call());
  console.log(call2());

  console.log(getter());

}
