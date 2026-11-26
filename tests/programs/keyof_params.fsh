// case: keyof_param_pick
// expect: ada
// expect: 7
// expect: true
type User = { id: i64; name: string; admin: boolean };
function pick<T, K extends keyof T>(o: Ref<T>, k: K): T[K] {
  return o[k];
}
function main(): void {
  const u: User = { id: 7, name: "ada", admin: true };
  console.log(pick(u, "name"));
  console.log(pick(u, "id"));
  console.log(pick(u, "admin"));
}

// case: keyof_param_in_body
// expect: x=1
// expect: label=p
type Point = { x: i64; label: string };
function show<T, K extends keyof T>(o: Ref<T>, k: K): string {
  const v: T[K] = o[k];
  return `${k}=${v}`;
}
function main(): void {
  const p: Point = { x: 1, label: "p" };
  console.log(show(p, "x"));
  console.log(show(p, "label"));
}

// case: keyof_param_wrong_key
// error: 'nope'
type User = { id: i64 };
function pick<T, K extends keyof T>(o: Ref<T>, k: K): T[K] {
  return o[k];
}
function main(): void {
  const u: User = { id: 1 };
  console.log(pick(u, "nope"));
}

// case: keyof_param_class
// expect: 3
class Box {
  size: i64;
  constructor(size: i64) {
    this.size = size;
  }
}
function field<T, K extends keyof T>(o: Ref<T>, k: K): T[K] {
  return o[k];
}
function main(): void {
  const b = new Box(3);
  console.log(field(b, "size"));
}
