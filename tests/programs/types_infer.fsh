// expect: 3 hi 7 ann
// expect: 5 ok 2 none
// `infer` names a type matched out of an array, a function, a promise, a generic class, an
// object field or an Option, and the std ReturnType and Awaited.
class Box<T> { v: T; constructor(v: T) { this.v = v; } }
type ElementOf<T> = T extends (infer E)[] ? E : never;
type Ret<F> = F extends (...args: any[]) => infer R ? R : never;
type FirstArg<F> = F extends (x: infer A, y: i64) => i64 ? A : never;
type Inner<T> = T extends Box<infer U> ? U : T;
type FieldOf<T> = T extends { name: infer N } ? N : "none";
type Unwrapped<T> = T extends Option<infer U> ? U : T;
type Small<T> = T extends infer N extends i64 ? N : "big";
type Callback = (n: i64, s: string) => string;
type Num = ElementOf<i64[]>;
type Text = Ret<Callback>;
type Arg = FirstArg<(x: boolean, y: i64) => i64>;
type Boxed = Inner<Box<i64>>;
type Named = FieldOf<{ name: string; age: i64 }>;
type Nameless = FieldOf<{ age: i64 }>;
type Plain = Unwrapped<i64 | null>;
type Ok = ReturnType<() => "ok">;
type Done = Awaited<Promise<Promise<i64>>>;
type Num2 = Small<i64>;
function main() {
  const n: Num = 3;
  const t: Text = "hi";
  const a: Arg = true;
  const b: Boxed = 7;
  const name: Named = "ann";
  const p: Plain = 5;
  const ok: Ok = "ok";
  const d: Done = 2;
  const no: Nameless = "none";
  const s: Num2 = 1;
  console.log(n, t, a ? b : 0, name);
  console.log(p, ok, d + s - 1, no);
}
