// Every diagnostic's code, as 'fishc explain' looks it up. A code names a kind of error, not one
// place that raises it, and keeps its meaning once given: new kinds take new numbers. Numbered
// by area:
//   E00xx syntax, lexing and editions
//   E01xx types: mismatches, inference, generics, unions, numbers and type-level functions
//   E02xx ownership and borrows: moves, borrows, lifetimes, mutability and copies
//   E03xx async and threads: await, lazy promises, Send, shared values, locks and Promise APIs
//   E04xx names and declarations: unknown and duplicate names, the top level, main, parameters
//   E05xx calls and members: argument counts, unknown members, std APIs and callbacks
//   E06xx control flow and errors: returns, throws, jumps, generators and match
//   E07xx classes, interfaces and enums
//   E08xx forms Fish doesn't support yet, and TypeScript forms Fish leaves out
//   E09xx modules, packages, manifests and lockfiles
//   E10xx interop: unsafe, C functions, libraries, Rust crates, JS packages and raw pointers
//   E11xx comptime, macros, decorators, quotes, tests and tags
//   W0xxx warnings
// A code's one-line title, and for the common ones a longer explanation with a program that
// fails with the code and one that compiles.
export type Explained = { title: string; long?: { text: string; example: string; fixed: string } };

export const CODES: Record<string, Explained> = {
  E0001: {
    title: "syntax error",
    long: {
      text: `The parser expected one thing and found another: a missing bracket, comma or operand, or a keyword in the wrong place. The message says what it expected and what it found.

TypeScript reports the same code as a syntax error. Fish parses all of TypeScript's syntax, plus 'match', '|>' and 'comptime', so code that parses as TypeScript parses here too.

To fix it, look at the caret and just before it for what is missing or extra.`,
      example: `function main() {
  console.log(1 +);
}`,
      fixed: `function main() {
  console.log(1 + 2);
}`,
    },
  },
  E0002: { title: "malformed token: an unterminated literal or comment, a bad escape, or an unexpected character" },
  E0003: { title: "invalid assignment or destructuring target" },
  E0004: { title: "a form written where it isn't allowed" },
  E0005: { title: "malformed edition directive" },
  E0006: { title: "a file in the TS-compat edition, which Fish doesn't compile" },

  E0101: {
    title: "mismatched types",
    long: {
      text: `A value's type doesn't fit where it is used: a string where a number is wanted, an object missing a field its type requires, a function whose parameters differ.

TypeScript reports the same mismatch as 'Type X is not assignable to type Y'. Fish has no 'any' to get around it, and its numbers have sized types, so an 'f64' doesn't fit an 'i64' either.

To fix it, give a value of the declared type, convert it, as in 'String(n)' or 'x as i64', or change the declaration.`,
      example: `function main() {
  const n: i64 = "five";
  console.log(n);
}`,
      fixed: `function main() {
  const n: i64 = 5;
  console.log(n);
}`,
    },
  },
  E0102: {
    title: "a condition that isn't a boolean",
    long: {
      text: `An 'if', a loop, '!', '&&' and '||' take a boolean. Fish has no truthiness: 0, "" and null aren't false, and a number or a string is never a condition.

In TypeScript, any value is truthy or falsy, so 'if (count)' means 'count !== 0' and 'if (name)' means the string isn't empty.

To fix it, write the comparison you mean: 'count !== 0', 's.length > 0', 'x !== null'.`,
      example: `function main() {
  const count = 3;
  if (count) console.log("some");
}`,
      fixed: `function main() {
  const count = 3;
  if (count !== 0) console.log("some");
}`,
    },
  },
  E0103: { title: "an operator applied to types it doesn't take" },
  E0104: {
    title: "a type that has to be written, since Fish can't work it out",
    long: {
      text: `Fish works a value's type out from what it is given, but some declarations give it nothing to work from: an empty array, a 'let' with no value, a function that calls itself, a generic call whose arguments don't say its type argument.

TypeScript would infer 'any' or 'never[]' for some of these. Fish needs a concrete type for every value, since it lays each one out in memory.

To fix it, write the type, as in 'const xs: string[] = []' or 'function f(n: i64): i64', or pass the type argument, as in 'JSON.parse<Point>(text)'.`,
      example: `function main() {
  const xs = [];
  console.log(xs.length);
}`,
      fixed: `function main() {
  const xs: string[] = [];
  console.log(xs.length);
}`,
    },
  },
  E0105: { title: "cannot find type" },
  E0106: { title: "wrong number of type arguments" },
  E0107: { title: "a type argument that doesn't satisfy its constraint" },
  E0108: {
    title: "an Option used without checking it, or checked when it is never empty",
    long: {
      text: `A value whose type includes 'null', an Option, is used as if it were there: an operator applied to it, or a method called on it. Or the opposite: '!', '?.' or '??' on a value that can never be null.

TypeScript with 'strictNullChecks' reports the first as 'Object is possibly null'; Fish always checks.

To fix it, check the value first with 'if (x !== null)', give a default with '??', or read through it with '?.'.`,
      example: `function main() {
  const m = new Map<string, i64>();
  const n = m.get("a");
  console.log(n + 1);
}`,
      fixed: `function main() {
  const m = new Map<string, i64>();
  const n = m.get("a");
  console.log((n ?? 0) + 1);
}`,
    },
  },
  E0109: {
    title: "a union used without narrowing it to one member",
    long: {
      text: `A value whose type is a union is used in a way only some of its members allow, such as assigning a field one member lacks.

TypeScript reports much the same thing. A Fish union is a tagged value that holds one member at a time, and narrowing says which; reading a field one member lacks is 'no such property', E0502, as in TypeScript.

To fix it, narrow the value first with 'typeof', 'instanceof', a comparison of a shared field, or 'match', then use it in that branch.`,
      example: `type Circle = { kind: "circle"; r: i64 };
type Square = { kind: "square"; side: i64 };
function grow(s: Mut<Circle | Square>) {
  s.r = 2;
}
function main() {
  let c: Circle | Square = { kind: "circle", r: 1 };
  grow(c);
}`,
      fixed: `type Circle = { kind: "circle"; r: i64 };
type Square = { kind: "square"; side: i64 };
function grow(s: Mut<Circle | Square>) {
  if (s.kind === "circle") s.r = 2;
}
function main() {
  let c: Circle | Square = { kind: "circle", r: 1 };
  grow(c);
}`,
    },
  },
  E0110: { title: "a number that doesn't fit its type" },
  E0111: { title: "a conversion between number types that has to be written" },
  E0112: { title: "a comparison between types that can't be equal" },
  E0113: { title: "a type or instance that would never end" },
  E0114: { title: "invalid type-level expression" },
  E0115: { title: "an interface or generic function type where a concrete type is needed" },
  E0116: { title: "a built-in type given the wrong type arguments" },
  E0117: { title: "a tuple's length or element index doesn't match" },
  E0118: { title: "a 'void' used as a value" },
  E0119: { title: "a value that can't be looped over or spread" },

  E0201: {
    title: "use of a moved value",
    long: {
      text: `Assigning an array, an object or a string to another variable, or passing it to a function that takes it owned, moves it: the new owner has it, and the old name can't be used any more. Numbers and booleans are copied instead.

In TypeScript, both names would refer to the same object, and a change through one would show through the other. Fish gives each value one owner, which is how it frees memory without a garbage collector.

To fix it, use the value through its new owner, borrow it instead (a parameter typed 'Ref<T>' or 'Mut<T>' borrows its argument), or hand over a copy with '.clone()'.`,
      example: `function main() {
  const a = [1, 2, 3];
  const b = a;
  console.log(a.length, b.length);
}`,
      fixed: `function main() {
  const a = [1, 2, 3];
  const b = a.clone();
  console.log(a.length, b.length);
}`,
    },
  },
  E0202: {
    title: "cannot move out of a borrowed value",
    long: {
      text: `A value is moved out of something that only borrows it: a field read out of a 'Ref' parameter, an element out of a borrowed array, a part of 'this' in a method that borrows 'this'. Moving it would leave the owner with a hole.

In TypeScript, reading a field gives another reference to the same object, so this is never an issue there.

To fix it, hand over a copy with '.clone()', borrow the part instead of moving it, or take the whole value owned.`,
      example: `class Bag {
  items: string[] = [];
}
function take(b: Ref<Bag>): string[] {
  return b.items;
}
function main() {
  const b = new Bag();
  console.log(take(b).length);
}`,
      fixed: `class Bag {
  items: string[] = [];
}
function take(b: Ref<Bag>): string[] {
  return b.items.clone();
}
function main() {
  const b = new Bag();
  console.log(take(b).length);
}`,
    },
  },
  E0203: {
    title: "conflicting borrows",
    long: {
      text: `A value is used while something else borrows it in a way that rules that use out: changed while it is borrowed, or borrowed mutably twice at once, as when the same value is passed as two 'Mut' arguments.

In TypeScript, two references to one object can both change it, and the result depends on the order of the changes. Fish allows many shared borrows or one mutable borrow at a time, which rules out that whole class of bug, and data races with it.

To fix it, end the first borrow before the second use, pass a copy, or restructure so one place makes the change.`,
      example: `type P = { x: i64 };
function two(a: Mut<P>, b: Mut<P>): i64 {
  return a.x + b.x;
}
function main() {
  let p: P = { x: 1 };
  console.log(two(p, p));
}`,
      fixed: `type P = { x: i64 };
function two(a: Mut<P>, b: Mut<P>): i64 {
  return a.x + b.x;
}
function main() {
  let p: P = { x: 1 };
  let q: P = { x: 2 };
  console.log(two(p, q));
}`,
    },
  },
  E0204: {
    title: "a borrowed value doesn't live long enough",
    long: {
      text: `A borrow is kept longer than the value it borrows lives: a reference to a block's local kept after the block, or a reference to a temporary kept after its statement.

In TypeScript, an object lives as long as anything refers to it, so this can't happen there. Fish frees a value when its owner's scope ends, so a reference can't outlive it.

To fix it, declare the value in an outer scope so it lives long enough, or keep an owned copy instead of a borrow.`,
      example: `function main() {
  let outer: string[] = [];
  const o: Mut<string[]> = outer;
  let h = { m: o };
  {
    let x: string[] = ["a"];
    const m: Mut<string[]> = x;
    h = { m: m };
  }
  h.m.push("b");
  console.log(h.m.length);
}`,
      fixed: `function main() {
  let outer: string[] = [];
  let x: string[] = ["a"];
  const o: Mut<string[]> = outer;
  let h = { m: o };
  {
    const m: Mut<string[]> = x;
    h = { m: m };
  }
  h.m.push("b");
  console.log(h.m.length);
}`,
    },
  },
  E0205: {
    title: "a variable used before it is assigned",
    long: {
      text: `A variable is read before every path that reaches the read has given it a value.

TypeScript reports the same thing as 'Variable is used before being assigned'.

To fix it, give the variable a value where it is declared, or on every branch before the read.`,
      example: `function main() {
  let n: i64;
  console.log(n);
}`,
      fixed: `function main() {
  let n: i64 = 0;
  console.log(n);
}`,
    },
  },
  E0206: {
    title: "cannot change a value through a shared reference",
    long: {
      text: `Something is changed through a shared reference, a 'Ref<T>' or a method's 'this' that is read-only. A shared reference only reads what it points at.

In TypeScript, a parameter can change the object it is given. Fish says in a function's signature whether it changes what it borrows, so callers know.

To fix it, take the value as 'Mut<T>' (or declare 'this: Mut<this>' on a method) so it may change it, and pass it a value that can be changed.`,
      example: `class Counter {
  n: i64 = 0;
}
function bump(c: Ref<Counter>) {
  c.n += 1;
}
function main() {
  let c = new Counter();
  bump(c);
  console.log(c.n);
}`,
      fixed: `class Counter {
  n: i64 = 0;
}
function bump(c: Mut<Counter>) {
  c.n += 1;
}
function main() {
  let c = new Counter();
  bump(c);
  console.log(c.n);
}`,
    },
  },
  E0207: {
    title: "cannot change a constant",
    long: {
      text: `A 'const' is assigned to, or a field of a 'const' is changed. A Fish 'const' is deeply immutable: nothing it holds can change.

In TypeScript, 'const' only stops the name from being reassigned, and the object it holds can still change.

To fix it, declare it with 'let' when it changes.`,
      example: `class Counter {
  n: i64 = 0;
}
function main() {
  const c = new Counter();
  c.n = 1;
  console.log(c.n);
}`,
      fixed: `class Counter {
  n: i64 = 0;
}
function main() {
  let c = new Counter();
  c.n = 1;
  console.log(c.n);
}`,
    },
  },
  E0208: { title: "cannot assign to a read-only property" },
  E0209: { title: "invalid lifetime" },
  E0210: { title: "a closure that captures a value in a way its use can't allow" },
  E0211: { title: "not possible through a Dyn" },
  E0212: { title: "a change that would only reach a temporary copy" },
  E0213: { title: "a value that can't be cloned" },

  E0301: {
    title: "async-only code outside an async function",
    long: {
      text: `'await', 'for await', 'spawn' and the timers run on Fish's async runtime, which runs inside an async function.

TypeScript reports a top-level 'await' outside a module, or one in a plain function, much the same way.

To fix it, make the function 'async', and 'main' too when the program awaits from it.`,
      example: `async function work(): Promise<i64> {
  return 1;
}
function main() {
  const n = await work();
  console.log(n);
}`,
      fixed: `async function work(): Promise<i64> {
  return 1;
}
async function main() {
  const n = await work();
  console.log(n);
}`,
    },
  },
  E0302: {
    title: "a Promise that is never awaited",
    long: {
      text: `An async function's call gives a Promise that does nothing until it is awaited: Fish's promises are lazy, so a call nobody awaits never runs.

In TypeScript, calling an async function starts it at once, and not awaiting it lets it run in the background.

To fix it, 'await' the call, or start it on its own with 'spawn(...)' when it should run alongside.`,
      example: `async function work() {
  console.log("working");
}
async function main() {
  work();
}`,
      fixed: `async function work() {
  console.log("working");
}
async function main() {
  await work();
}`,
    },
  },
  E0303: {
    title: "a value that can't cross to another thread",
    long: {
      text: `A value that can't safely cross to another thread is given to something that may run there: a 'spawn'ed task, a 'shared' value, a 'Channel'. A borrow of a local or a 'Cell' would let two threads reach the same memory without a lock.

TypeScript runs on one thread, so it has no such rule; Fish's runtime runs tasks on every core.

To fix it, give the task owned values (clone what it needs), and use 'Atomic', 'Lock' or 'shared' for state threads share.`,
      example: `async function first(xs: Ref<string[]>): Promise<string> {
  return xs[0];
}
async function main() {
  const names = ["a"];
  const name = await spawn(first(names));
  console.log(name);
}`,
      fixed: `async function first(xs: string[]): Promise<string> {
  return xs[0];
}
async function main() {
  const names = ["a"];
  const name = await spawn(first(names.clone()));
  console.log(name, names.length);
}`,
    },
  },
  E0304: { title: "a shared value or lock used in a way other tasks could see half done" },
  E0305: { title: "invalid use of a Promise, a task or the Promise API" },

  E0401: {
    title: "cannot find name",
    long: {
      text: `A name is used that nothing in scope declares: a typo, a missing import, or a variable from another function.

TypeScript reports the same thing as 'Cannot find name'.

To fix it, check the spelling (the message suggests a near match when there is one), import the name, or declare it.`,
      example: `function main() {
  const total = 1;
  console.log(totl);
}`,
      fixed: `function main() {
  const total = 1;
  console.log(total);
}`,
    },
  },
  E0402: {
    title: "a name defined twice",
    long: {
      text: `Two declarations give the same name in one scope: two variables, two members of a class, two types.

TypeScript reports the same thing as 'Cannot redeclare' or 'Duplicate identifier'.

To fix it, rename one of them, or remove the one you don't need.`,
      example: `function main() {
  let a = 1;
  let a = 2;
  console.log(a);
}`,
      fixed: `function main() {
  let a = 1;
  let b = 2;
  console.log(a + b);
}`,
    },
  },
  E0403: { title: "a name used before its declaration" },
  E0404: { title: "something at the top level that only belongs in a function" },
  E0405: { title: "invalid or missing main()" },
  E0406: { title: "a declaration that needs its value where it is declared" },
  E0407: { title: "a name that is reserved" },
  E0408: { title: "invalid parameter list" },
  E0409: { title: "a local declaration that uses what it can't reach" },
  E0410: { title: "invalid overload signatures" },

  E0501: {
    title: "wrong number of arguments",
    long: {
      text: `A function is called with more or fewer arguments than its parameters take.

TypeScript reports the same thing as 'Expected N arguments, but got M'.

To fix it, pass one argument per required parameter, or make a parameter optional with '?' or a default.`,
      example: `function add(a: i64, b: i64): i64 {
  return a + b;
}
function main() {
  console.log(add(1));
}`,
      fixed: `function add(a: i64, b: i64): i64 {
  return a + b;
}
function main() {
  console.log(add(1, 2));
}`,
    },
  },
  E0502: {
    title: "no such property or method",
    long: {
      text: `A field or method is used that the value's type doesn't have, or that Fish's std doesn't provide for it yet.

TypeScript reports the same thing as 'Property x does not exist on type T'.

To fix it, check the spelling (the message suggests a near match when there is one), or add the field or method to the type.`,
      example: `function main() {
  const p = { x: 1, y: 2 };
  console.log(p.z);
}`,
      fixed: `function main() {
  const p = { x: 1, y: 2 };
  console.log(p.y);
}`,
    },
  },
  E0503: { title: "a value called that isn't a function, or a function used without calling it" },
  E0504: { title: "invalid arguments to a built-in function" },
  E0505: { title: "'?.' on something that is always there" },
  E0506: { title: "a callback that doesn't fit what it is given to" },
  E0507: { title: "no overload matches" },
  E0508: { title: "invalid use of a regex" },
  E0509: { title: "a type that can't be read from or written to JSON" },
  E0510: { title: "a value that can't be printed or formatted" },

  E0601: {
    title: "a path that ends without giving a value",
    long: {
      text: `A function says it returns a value, but some path through its body reaches the end without returning one.

TypeScript reports the same thing as 'Not all code paths return a value'.

To fix it, return a value on every path, often by adding a final 'return' or an 'else'.`,
      example: `function sign(n: i64): i64 {
  if (n > 0) return 1;
  if (n < 0) return -1;
}
function main() {
  console.log(sign(2));
}`,
      fixed: `function sign(n: i64): i64 {
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}
function main() {
  console.log(sign(2));
}`,
    },
  },
  E0602: {
    title: "an error thrown where it isn't handled or declared",
    long: {
      text: `An error can be thrown somewhere that doesn't handle it or declare it. In Fish, errors are values a function's type states: a function that can throw says 'throws E' after its return type, and its callers catch the error or declare it in turn.

In TypeScript, any function may throw anything, and nothing in its type says so.

To fix it, declare it, as in 'function f(): i64 throws Error', or catch it with try/catch.`,
      example: `function half(n: i64): i64 {
  if (n % 2 !== 0) throw new Error("odd");
  return n / 2;
}
function main() {
  console.log(half(4));
}`,
      fixed: `function half(n: i64): i64 throws Error {
  if (n % 2 !== 0) throw new Error("odd");
  return n / 2;
}
function main() {
  try {
    console.log(half(4));
  } catch (e) {
    console.log(e.message);
  }
}`,
    },
  },
  E0603: { title: "a catch that can never run" },
  E0604: { title: "a jump with nowhere to go" },
  E0605: { title: "a return that doesn't fit where it is" },
  E0606: { title: "invalid use of a generator or 'yield'" },
  E0607: { title: "a match that doesn't cover every case, or a pattern that can't match" },
  E0608: { title: "a switch with more than one default" },

  E0701: { title: "invalid use of an abstract class or member" },
  E0702: { title: "a class that doesn't implement what it says it does" },
  E0703: { title: "a constructor that doesn't set up its object first" },
  E0704: { title: "a subclass that conflicts with the class it extends" },
  E0705: { title: "invalid getter or setter" },
  E0706: { title: "invalid static member" },
  E0707: { title: "invalid enum" },
  E0708: { title: "'this' or 'super' where there is none" },
  E0709: { title: "a private or protected member used from outside" },

  E0801: {
    title: "a form Fish doesn't support yet",
    long: {
      text: `The code uses a form that parses, since Fish parses all of TypeScript, but that Fish doesn't compile yet. The message names the form, and usually what to write instead.

In TypeScript, the form is valid.

To fix it, rewrite it with what the message suggests. Running 'fishc survey' over a TypeScript project lists the forms it uses that Fish doesn't support yet.`,
      example: `namespace Util {
  export const two = 2;
}
function main() {
  console.log(1);
}`,
      fixed: `const two = 2;
function main() {
  console.log(two);
}`,
    },
  },
  E0802: {
    title: "a TypeScript form Fish leaves out",
    long: {
      text: `The code uses a TypeScript form that Fish leaves out on purpose, such as 'var', or changing a string in place.

In TypeScript, the form is valid.

To fix it, write it the way the message says: 'let' or 'const' for 'var', a new string for a changed one. 'fishc lint' finds these forms in TypeScript code and fixes many of them.`,
      example: `function main() {
  var n = 1;
  console.log(n);
}`,
      fixed: `function main() {
  let n = 1;
  console.log(n);
}`,
    },
  },

  E0901: { title: "cannot find the file or package an import names" },
  E0902: { title: "an import of a name its module doesn't export" },
  E0903: { title: "an import that crosses a package's boundary" },
  E0904: { title: "a manifest that isn't valid TOML" },
  E0905: { title: "invalid manifest" },
  E0906: { title: "a dependency that can't be resolved or verified" },
  E0907: { title: "an import that clashes with another name in its file" },
  E0908: { title: "a Node built-in Fish doesn't have, or uses differently" },

  E1001: { title: "an operation that needs 'unsafe'" },
  E1002: { title: "invalid C function declaration" },
  E1003: { title: "a function a library can't export to C" },
  E1004: { title: "invalid Rust crate declaration or use" },
  E1005: { title: "a value that can't cross between Fish and JS" },
  E1006: { title: "invalid use of a raw pointer" },

  E1101: { title: "comptime code that failed while compiling" },
  E1102: { title: "invalid comptime parameter or block" },
  E1103: { title: "invalid macro" },
  E1104: { title: "invalid decorator or derive" },
  E1105: { title: "invalid quote" },
  E1106: { title: "invalid test" },
  E1107: { title: "invalid tagged template" },

  W0001: {
    title: "unused binding",
    long: {
      text: `A variable, parameter or function is declared and never used. It is a warning, so the program still builds.

TypeScript reports the same thing with 'noUnusedLocals' and 'noUnusedParameters'.

To fix it, remove it, or name it with a leading '_' when it is unused on purpose.`,
      example: `function main() {
  const unused = 1;
  console.log(2);
}`,
      fixed: `function main() {
  const _unused = 1;
  console.log(2);
}`,
    },
  },
  W0002: { title: "unreachable code" },
};

// What 'fishc explain' prints for `code`, or undefined when no code is that.
export function explain(code: string): string | undefined {
  const name = code.toUpperCase();
  const found = CODES[name];
  if (!found) return undefined;
  const head = `${name}: ${found.title}`;
  if (!found.long) return `${head}\n\nThis code has no longer explanation yet; its message says what went wrong and what to change.`;
  const indent = (text: string) => text.split("\n").map((line) => `    ${line}`).join("\n");
  const fails = name.startsWith("W") ? "warns" : "fails";
  return `${head}\n\n${found.long.text}\n\nFor example, this ${fails}:\n\n${indent(found.long.example)}\n\nand this compiles:\n\n${indent(found.long.fixed)}`;
}
