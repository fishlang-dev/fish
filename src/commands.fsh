// fishc's version and its commands: what `--version`, `fishc help` and every usage error print.
// scripts/release.fsh sets VERSION to fish.toml's version when it cuts a release.
export const VERSION = "0.1.3";

export type Command = { name: string; summary: string; usage: string[] };

// In the order `fishc help` lists them. Each usage line is printed as written.
export const COMMANDS: Command[] = [
  {
    name: "build",
    summary: "compile a program, a library, a Node addon or a mobile module",
    usage: [
      "fishc build [<file.fsh>] [-o <out>] [--release] [-g] [--locked] [--panic=unwind|abort] [--link <library>]... [--lib[=static|shared]] [--target <triple>] [--sysroot <dir>] [--arena <bytes>] [--static [--dockerfile]] [--leaks] [--timings] [--emit-llvm] [--profile] [--heap-profile] [--sanitize address|thread] [--pgo-instrument | --pgo <profile>...] [--flag <name>[=<value>]]...",
      "fishc build --addon <file.fsh> [-o <out.node>] [--release] [-g]",
      "fishc build --mobile ios|android|react-native <file.fsh> [-o <dir>] [--release] [-g] [--sysroot <ndk>]",
    ],
  },
  { name: "check", summary: "check a program without building it", usage: ["fishc check [<file.fsh>] [--timings] [--no-check-cache] [--flag <name>[=<value>]]..."] },
  { name: "run", summary: "build a program and run it", usage: ["fishc run [<file.fsh>] [--release] [-g] [--leaks] [--profile] [--heap-profile] [--timings] [--flag <name>[=<value>]]... [-- <args>...]"] },
  { name: "watch", summary: "rebuild and rerun a program whenever its files change", usage: ["fishc watch [<file.fsh>] [--release] [-g] [--leaks] [--profile] [--heap-profile] [--timings] [--flag <name>[=<value>]]... [-- <args>...]"] },
  { name: "dev", summary: "serve a program, swapping in its changed handlers while connections and state stay", usage: ["fishc dev [<file.fsh>] [--locked]"] },
  { name: "repl", summary: "try lines of Fish one at a time", usage: ["fishc repl"] },
  { name: "new", summary: "make a package in a new directory", usage: ["fishc new <name>"] },
  { name: "init", summary: "make a package in this directory", usage: ["fishc init [<name>]"] },
  { name: "add", summary: "add a dependency from the registry", usage: ["fishc add <name>[@<range>]"] },
  { name: "update", summary: "move dependencies to the newest versions their ranges allow", usage: ["fishc update [<name>]"] },
  { name: "publish", summary: "pack a package and submit it to the registry", usage: ["fishc publish [--dry-run] [--allow-dirty] [--submit [--fork <url>] [--yes]]"] },
  { name: "fmt", summary: "format Fish source", usage: ["fishc fmt [<path>...] [--check]", "fishc fmt - [--check]"] },
  { name: "lint", summary: "report TypeScript habits that mean something else in Fish", usage: ["fishc lint [<path>...] [--fix]"] },
  { name: "fix", summary: "apply the fixes the compiler suggests for borrow, move and mutability errors", usage: ["fishc fix [<file.fsh>] [--dry-run] [--check]"] },
  { name: "test", summary: "run a package's test blocks", usage: ["fishc test [<filter>] [--release] [--timeout <ms>] [--jobs <n>] [--no-doc] [--seed <n>] [--sim [--seed <n>] [--seeds <count>]]"] },
  { name: "fuzz", summary: "run a package's fuzz blocks", usage: ["fishc fuzz [<file.fsh>] [<filter>] [--runs <n>] [--max-time <sec>] [--corpus <dir>] [--artifacts <dir>] [--replay <file>] [--no-asan] [--list]"] },
  { name: "survey", summary: "grade how much of a TypeScript project ports to Fish", usage: ["fishc survey <dir> [--compare <old.json>] [--json]", "fishc survey --rank <dir>... [--self <dir>] [--plan <build-plan.md>] [--json]"] },
  { name: "explain", summary: "explain an error code", usage: ["fishc explain <code>"] },
  { name: "explain-borrows", summary: "show where ownership moves and lends values, line by line", usage: ["fishc explain-borrows <file.fsh> [--fn <name>]"] },
  { name: "learn", summary: "work through the exercises that teach Fish", usage: ["fishc learn [hint] [--check]"] },
  { name: "doc", summary: "write HTML documentation for a package", usage: ["fishc doc [<file.fsh>] [-o <dir>]"] },
  { name: "openapi", summary: "write the OpenAPI document of a program's routes", usage: ["fishc openapi <file.fsh> [-o <out>]"] },
  { name: "client", summary: "write a TypeScript client for a program's routes", usage: ["fishc client <file.fsh> [-o <out.ts>]", "fishc client --types <file.fsh> [-o <out.d.ts>]"] },
  { name: "bind", summary: "write Fish declarations for a C header", usage: ["fishc bind c <header.h> [-o <out.fsh>] [-- <clang flags>...]"] },
  { name: "heap", summary: "compare two heap profiles", usage: ["fishc heap diff <before.pb> <after.pb>"] },
  { name: "parse", summary: "print a file's syntax tree", usage: ["fishc parse <file.fsh>"] },
  { name: "lsp", summary: "serve the language server over stdio", usage: ["fishc lsp"] },
  { name: "help", summary: "list the commands, or show one's usage", usage: ["fishc help [<command>]"] },
];

export function commandNamed(name: string): Command | undefined {
  return COMMANDS.find((c) => c.name === name);
}

// The usage text a command prints when it is given arguments it doesn't take.
export function usageOf(name: string): string {
  const lines = commandNamed(name)!.usage;
  let out = "";
  for (let i: usize = 0; i < lines.length; i++) out += `${i === 0 ? "usage: " : "\n       "}${lines[i]!}`;
  return out;
}

// What `fishc help <command>` prints, or undefined for a name that isn't a command.
export function helpOf(name: string): string | undefined {
  const c = commandNamed(name);
  if (c === undefined) return undefined;
  return `fishc ${c.name}: ${c.summary}\n\n${usageOf(name)}`;
}

// What `fishc help` prints: every command and what it does.
export function overview(): string {
  let width: usize = 0;
  for (const c of COMMANDS) if (c.name.length > width) width = c.name.length;
  let out = `fishc ${VERSION}, the Fish compiler\n\nusage: fishc <command> [<args>...]\n       fishc <file.fsh> [<args>...]\n\ncommands:\n`;
  for (const c of COMMANDS) out += `  ${c.name.padEnd(width)}  ${c.summary}\n`;
  return `${out}\nrun 'fishc help <command>' for a command's usage`;
}
