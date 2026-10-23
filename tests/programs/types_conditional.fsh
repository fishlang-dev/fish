// expect: hi b 3 yes
// expect: 2 c no
// Conditional types, distributed over a union a type parameter stands for, and the std
// Exclude, Extract and NonNullable, computed while compiling.
type NonNull<T> = T extends null ? never : T;
type IsText<T> = T extends string ? "yes" : "no";
type Name = NonNull<string | null>;
type Letters = "a" | "b" | "c";
type NotA = Exclude<Letters, "a">;
type OnlyC = Extract<Letters, "c" | "z">;
type Count = NonNullable<i64 | null>;
type P<T> = Partial<T>;
type Loose = P<{ id: i64; name: string }>;
type Answer = IsText<"hi">;
type Wide = IsText<i64>;
function greet(n: Name): string { return n; }
function main() {
  const b: NotA = "b";
  const c: OnlyC = "c";
  const n: Count = 3;
  const l: Loose = { id: 2 };
  const yes: Answer = "yes";
  const no: Wide = "no";
  console.log(greet("hi"), b, n, yes);
  console.log(l.id ?? 0, c, no);
}
