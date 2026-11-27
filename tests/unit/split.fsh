// A file's part of the IR is divided once its functions' text passes a limit: each part defines
// its share, in the IR's order, and declares what it calls of the others'.
import { scalarUses } from "../../src/layout.fsh";
import { split } from "../../src/split.fsh";

function ir(): string {
  const lines = [
    'define internal void @"fsh.a"() {',
    "entry:",
    '  call void @"fsh.b"()',
    "  ret void",
    "}",
    "",
    'define internal void @"fsh.b"() {',
    "entry:",
    "  ret void",
    "}",
    "",
    'define internal void @"fsh.main"() {',
    "entry:",
    '  call void @"fsh.a"()',
    "  ret void",
    "}",
    "",
  ];
  return lines.join("\n");
}

function groups(): Map<string, string[]> {
  return new Map<string, string[]>([["f.fsh", ['@"fsh.a"', '@"fsh.b"']]]);
}

const OWN = ['@"fsh.a"', '@"fsh.b"', '@"fsh.main"'];

test("a file's functions stay one part with no limit", () => {
  const halves = split([ir()], [], [...OWN], groups());
  assert([...halves.groups.keys()].join(" ") === "f.fsh", "one part");
  const part = halves.groups.get("f.fsh") ?? "";
  assert(part.includes('define void @"fsh.a"()') && part.includes('define void @"fsh.b"()'), part);
});

test("a file's functions over the limit are divided, each part declaring the others'", () => {
  const halves = split([ir()], [], [...OWN], groups(), 1);
  assert([...halves.groups.keys()].join(" ") === "f.fsh f.fsh#2", [...halves.groups.keys()].join(" "));
  const first = halves.groups.get("f.fsh") ?? "";
  const second = halves.groups.get("f.fsh#2") ?? "";
  assert(first.includes('define void @"fsh.a"()') && first.includes('declare void @"fsh.b"()'), first);
  assert(!first.includes('define void @"fsh.b"()'), first);
  assert(second.includes('define void @"fsh.b"()') && !second.includes("fsh.a"), second);
  assert(halves.program.includes('define void @"fsh.main"()') && halves.program.includes('declare void @"fsh.a"()'), halves.program);
});

test("a limit a file's functions fit under divides nothing", () => {
  const halves = split([ir()], [], [...OWN], groups(), 100000);
  assert([...halves.groups.keys()].join(" ") === "f.fsh", "one part");
});

test("the program's own functions over the limit are divided, the first part keeping the rest", () => {
  const halves = split([ir()], [], [...OWN], new Map<string, string[]>(), 1);
  assert(halves.rest.length === 2, `${halves.rest.length} more parts`);
  assert(halves.program.includes('define void @"fsh.a"()') && halves.program.includes('declare void @"fsh.b"()'), halves.program);
  assert(halves.rest[1]!.includes('define void @"fsh.main"()') && halves.rest[1]!.includes('declare void @"fsh.a"()'), halves.rest[1]!);
  assert(split([ir()], [], [...OWN], new Map<string, string[]>()).rest.length === 0, "divided with no limit");
});

test("std's functions over the limit are divided as a file's are", () => {
  const std = ['@"fsh.a"', '@"fsh.b"'];
  const whole = split([ir()], [...std], ['@"fsh.main"'], new Map<string, string[]>());
  assert(whole.std.length === 1, `${whole.std.length} parts`);
  const halves = split([ir()], [...std], ['@"fsh.main"'], new Map<string, string[]>(), 1);
  assert(halves.std.length === 2, `${halves.std.length} parts`);
  assert(halves.std[0]!.includes('define void @"fsh.a"()') && halves.std[0]!.includes('declare void @"fsh.b"()'), halves.std[0]!);
  assert(halves.std[1]!.includes('define void @"fsh.b"()') && !halves.std[1]!.includes("fsh.a"), halves.std[1]!);
});

// Two instances of `walk` with the same text, each called by an instance of `visit`, and `main`
// calling both `visit`s. `differs` gives the second `walk` text of its own.
function instances(differs: boolean): string {
  const lines = [
    'define internal i64 @"fsh.walk#aaaaaa"(i64 %n) {',
    "entry:",
    '  %r = call i64 @"fsh.walk#aaaaaa"(i64 %n)',
    "  ret i64 %r",
    "}",
    "",
    'define internal i64 @"fsh.walk#bbbbbb"(i64 %n) {',
    "entry:",
    '  %r = call i64 @"fsh.walk#bbbbbb"(i64 %n)',
    differs ? "  ret i64 0" : "  ret i64 %r",
    "}",
    "",
    'define internal i64 @"fsh.visit#bbbbbb"(i64 %n) {',
    "entry:",
    '  %r = call i64 @"fsh.walk#bbbbbb"(i64 %n)',
    "  ret i64 %r",
    "}",
    "",
    'define internal i64 @"fsh.visit#aaaaaa"(i64 %n) {',
    "entry:",
    '  %r = call i64 @"fsh.walk#aaaaaa"(i64 %n)',
    "  ret i64 %r",
    "}",
    "",
    'define internal i64 @"fsh.main"() {',
    "entry:",
    '  %a = call i64 @"fsh.visit#aaaaaa"(i64 1)',
    '  %b = call i64 @"fsh.visit#bbbbbb"(i64 2)',
    "  ret i64 %b",
    "}",
    "",
  ];
  return lines.join("\n");
}

const INSTANCES = ['@"fsh.walk#aaaaaa"', '@"fsh.walk#bbbbbb"', '@"fsh.visit#aaaaaa"', '@"fsh.visit#bbbbbb"', '@"fsh.main"'];

function defined(text: string): string {
  let names: string[] = [];
  for (const line of text.split("\n")) if (line.startsWith("define ")) names.push(line.slice(line.indexOf("@") as i64, line.indexOf("(") as i64));
  return names.join(" ");
}

test("instances of one function with the same text become the one with the smallest symbol", () => {
  const halves = split([instances(false)], [], [...INSTANCES], new Map<string, string[]>());
  // The two walks merge first, which makes the two visits the same, so they merge in turn.
  assert(defined(halves.program) === '@"fsh.walk#aaaaaa" @"fsh.visit#aaaaaa" @"fsh.main"', defined(halves.program));
  assert(!halves.program.includes("bbbbbb"), halves.program);
  assert(halves.program.includes('%b = call i64 @"fsh.visit#aaaaaa"(i64 2)'), halves.program);
});

test("instances whose text differs stay apart, and so do their callers", () => {
  const halves = split([instances(true)], [], [...INSTANCES], new Map<string, string[]>());
  assert(defined(halves.program) === '@"fsh.walk#aaaaaa" @"fsh.walk#bbbbbb" @"fsh.visit#bbbbbb" @"fsh.visit#aaaaaa" @"fsh.main"', defined(halves.program));
});

test("std's instances are left as they are", () => {
  const halves = split([instances(false)], ['@"fsh.walk#aaaaaa"', '@"fsh.walk#bbbbbb"'], ['@"fsh.visit#aaaaaa"', '@"fsh.visit#bbbbbb"', '@"fsh.main"'], new Map<string, string[]>());
  assert(defined(halves.std) === '@"fsh.walk#aaaaaa" @"fsh.walk#bbbbbb"', defined(halves.std));
  assert(defined(halves.program) === '@"fsh.visit#bbbbbb" @"fsh.visit#aaaaaa" @"fsh.main"', defined(halves.program));
});

test("a merged function's part declares the one kept, wherever its callers are", () => {
  const groups = new Map<string, string[]>([["w.fsh", ['@"fsh.walk#aaaaaa"', '@"fsh.walk#bbbbbb"']]]);
  const halves = split([instances(false)], [], [...INSTANCES], groups);
  assert(defined(halves.groups.get("w.fsh") ?? "") === '@"fsh.walk#aaaaaa"', halves.groups.get("w.fsh") ?? "");
  assert(halves.program.includes('declare i64 @"fsh.walk#aaaaaa"(i64)') && !halves.program.includes("bbbbbb"), halves.program);
});

test("a part's scalar uses count each named struct's scalars at every use", () => {
  const text = ['%"<a>" = type { i64, [3 x i64] }', '%"<b>" = type { %"<a>", ptr }', "define void @f(ptr %p) {", '  %x = load %"<a>", ptr %p', '  %y = load %"<b>", ptr %p', '  store %"<b>" %y, ptr %p', "  ret void", "}", ""].join("\n");
  assert(scalarUses(text) === 14, `${scalarUses(text)}`);
  assert(scalarUses("define void @f() {\n  ret void\n}\n") === 0, "no structs");
});
