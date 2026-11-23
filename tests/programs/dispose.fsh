// case: dispose_declared
class Res {
  name: string;
  constructor(name: string) { this.name = name; }
  [Symbol.dispose](this: Mut<this>): void { console.log(`dispose ${this.name}`); }
}
function main() {
  const r = new Res("a");
  console.log(r.name);
}
// expect: a
// expect: dispose a
// case: dispose_read_only_receiver
class Res {
  name: string;
  constructor(name: string) { this.name = name; }
  [Symbol.dispose]() { console.log(`dispose ${this.name}`); }
}
function main() {
  const r = new Res("a");
  console.log(r.name);
}
// expect: a
// expect: dispose a
// case: dispose_parameter
class Res {
  [Symbol.dispose](this: Mut<this>, force: boolean): void {}
}
function main() {}
// error: 2:37: error[E0710]: a '[Symbol.dispose]' method takes no parameters
// case: dispose_type_parameter
class Res {
  [Symbol.dispose]<T>(): void {}
}
function main() {}
// error: error[E0710]: a '[Symbol.dispose]' method takes no type parameters
// case: dispose_async
class Res {
  async [Symbol.dispose](): Promise<void> {}
}
function main() {}
// error: error[E0710]: a '[Symbol.dispose]' method can't be async, since a drop doesn't wait
// case: dispose_generator
class Res {
  *[Symbol.dispose](): Generator<i64> { yield 1; }
}
function main() {}
// error: error[E0710]: a '[Symbol.dispose]' method can't be a generator
// case: dispose_throws
class Res {
  [Symbol.dispose](): void throws Error { throw new Error("no"); }
}
function main() {}
// error: error[E0710]: a '[Symbol.dispose]' method can't throw, since a drop has nowhere to send an error; handle it inside
// case: dispose_static
class Res {
  static [Symbol.dispose](): void {}
}
function main() {}
// error: error[E0710]: a '[Symbol.dispose]' method can't be static, since it disposes one instance
// case: dispose_own_receiver
class Res {
  [Symbol.dispose](this: Own<this>): void {}
}
function main() {}
// error: 2:20: error[E0710]: a '[Symbol.dispose]' method borrows the instance being dropped, so it can't take 'this: Own<this>'
// case: dispose_returns_a_value
class Res {
  [Symbol.dispose](): i64 { return 1; }
}
function main() {}
// error: error[E0710]: a '[Symbol.dispose]' method returns nothing; write it as '[Symbol.dispose](this: Mut<this>): void { ... }'
// case: dispose_unwritten_return
class Res {
  [Symbol.dispose]() { return 1; }
}
function main() {}
// error: error[E0
// case: dispose_by_hand
class Res {
  [Symbol.dispose](): void {}
}
function main() {
  const r = new Res();
  r[Symbol.dispose]();
}
// error: 6:3: error[E0710]: a '[Symbol.dispose]' method runs when its value is dropped, so it can't be called by hand, which would dispose the value twice
// case: dispose_by_hand_on_this
class Res {
  [Symbol.dispose](): void {}
  close(this: Mut<this>): void { this[Symbol.dispose](); }
}
function main() {}
// error: error[E0710]: a '[Symbol.dispose]' method runs when its value is dropped, so it can't be called by hand
// case: dispose_by_hand_quoted
class Res {
  [Symbol.dispose](): void {}
}
function main() {
  const r = new Res();
  r["[Symbol.dispose]"]();
}
// error: error[E0710]: a '[Symbol.dispose]' method runs when its value is dropped, so it can't be called by hand
// case: dispose_quoted_name
class Res {
  "[Symbol.dispose]"(): void {}
}
function main() {}
// error: error[E0120]: '[Symbol.dispose]' as a quoted name would name a '[Symbol.dispose]' method, which is only written as '[Symbol.dispose]'
// case: dispose_object_literal
function main() {
  const o = { [Symbol.dispose]() {} };
}
// error: error[E0801]: '[Symbol.dispose]' members other than a class's method, which runs when an instance is dropped, are not supported yet
// case: dispose_interface_member
interface Closer {
  [Symbol.dispose](): void;
}
function main() {}
// error: error[E0801]: '[Symbol.dispose]' members other than a class's method, which runs when an instance is dropped, are not supported yet
// case: dispose_field
class Res {
  [Symbol.dispose]: i64 = 1;
}
function main() {}
// error: error[E0801]: '[Symbol.dispose]' members other than a class's method, which runs when an instance is dropped, are not supported yet
