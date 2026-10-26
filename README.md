# Fish

Fish (`.fsh`) is a memory-safe language that compiles to native binaries. Its syntax is
TypeScript's, and its semantics are Rust's: ownership and borrowing, no garbage collector, no
`null`. It's aimed at TypeScript developers who want one fast binary instead of a Node or Bun
backend, and HTTP services are the first target.

```ts
class Account {
  owner: string = ""
  balance: i64 = 0

  deposit(this: Mut<this>, amount: i64) {
    this.balance += amount
  }
}

enum Event { Deposit(i64), Close }

function describe(a: Ref<Account>): string {
  return `${a.owner}: ${a.balance}`
}

function main() {
  let account: Account = { owner: "ada", balance: 0 }
  const events = [Event.Deposit(40), Event.Deposit(2), Event.Close]
  for (const e of events) {
    match (e) {
      case Deposit(n) => account.deposit(n),
      case Close => console.log("closing", describe(account)),
    }
  }
}
```

Ownership errors read in TypeScript terms:

```
main.fsh:6:15: error: 'account.balance' can't be used here because 'account' was moved
 6 |   console.log(account.balance)
   |               ^^^^^^^^^^^^^^^
main.fsh:5:9: note: 'account' moved here: passing it to 'close' hands it over, as if 'close' kept it; pass 'account.clone()' to keep a copy
```

## Status

Fish is pre-release and built by one person. This repository holds the bootstrap compiler,
written in TypeScript and run on Bun. It parses Fish, checks types and borrows, emits LLVM IR as
text, and links it with clang into a native executable.

Working today:
- classes, structural types, interfaces, generics, enums with data, `match`, pipes (`x |> f(%)`)
- `Ref<T>`, `Mut<T>`, `Own<T>`, explicit lifetimes, moves, and `Dyn<T>`
- `throws` clauses and error propagation
- `async`/`await` on a multithreaded runtime, `spawn`, `shared<T>`, `Atomic`, `Lock`, `Cell`
- comptime, macros and decorators
- typed JSON, regular expressions, TCP and HTTP, modules, and C FFI behind `unsafe`

Designed but not built yet: `Lazy<T>`, `Arena<T>`, the `@route` registry, in-file `test()`
blocks, lazy iterators (`arr.iter()`), operator-overloading traits, and the package manager,
formatter and language server.

## Building a program

You need [Bun](https://bun.sh) 1.4 and clang, on Linux or macOS (x86-64 or ARM64).

```sh
bun install
bun src/main.ts build hello.fsh -o hello
./hello
```

`fishc build` also takes `--release`, `--panic=abort`, `--link <library>`, `--lib[=static|shared]`
(a C library, with a header) and `--emit-llvm`.

The first build compiles the `Math` runtime once into `~/.cache/fish` (or `$FISH_CACHE_DIR`).
Its functions are correctly rounded, so a program prints the same numbers on every platform.

## Tests

```sh
bun test           # every program in tests/programs, plus the unit tests
bun run typecheck
```

Each program in `tests/programs` states what it expects in comments: `// expect:` for output,
and `// error:` or `// panic:` for a failure. `tests/run.test.ts` explains the format.

## Layout

| Path | What it holds |
| --- | --- |
| `src/main.ts` | the `fishc` command |
| `src/parser.ts`, `src/check.ts`, `src/values.ts`, `src/moves.ts` | parsing, type checking, and the borrow checker |
| `src/codegen.ts` | LLVM IR generation |
| `src/native.ts` | the C half of the runtime: allocation, strings, tasks, I/O |
| `src/runtime/math.cpp`, `vendor/` | the correctly rounded `Math` functions (see `vendor/README.md`) |
| `tests/programs` | the `.fsh` test programs |

## Licence

Fish is dual-licensed under either of

- the MIT licence ([LICENSE-MIT](LICENSE-MIT)), or
- the Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE)),

at your option. Unless you say otherwise, any contribution you submit for inclusion is
dual-licensed in the same way, with no additional terms or conditions.

The vendored code in `vendor/` keeps its own licences: Apache-2.0 WITH LLVM-exception for LLVM
libc, and MIT for CORE-MATH.
