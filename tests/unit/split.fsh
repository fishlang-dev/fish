// A file's part of the IR is divided once its functions' text passes a limit: each part defines
// its share, in the IR's order, and declares what it calls of the others'.
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
  const halves = split(ir(), [], [...OWN], groups());
  assert([...halves.groups.keys()].join(" ") === "f.fsh", "one part");
  const part = halves.groups.get("f.fsh") ?? "";
  assert(part.includes('define void @"fsh.a"()') && part.includes('define void @"fsh.b"()'), part);
});

test("a file's functions over the limit are divided, each part declaring the others'", () => {
  const halves = split(ir(), [], [...OWN], groups(), 1);
  assert([...halves.groups.keys()].join(" ") === "f.fsh f.fsh#2", [...halves.groups.keys()].join(" "));
  const first = halves.groups.get("f.fsh") ?? "";
  const second = halves.groups.get("f.fsh#2") ?? "";
  assert(first.includes('define void @"fsh.a"()') && first.includes('declare void @"fsh.b"()'), first);
  assert(!first.includes('define void @"fsh.b"()'), first);
  assert(second.includes('define void @"fsh.b"()') && !second.includes("fsh.a"), second);
  assert(halves.program.includes('define void @"fsh.main"()') && halves.program.includes('declare void @"fsh.a"()'), halves.program);
});

test("a limit a file's functions fit under divides nothing", () => {
  const halves = split(ir(), [], [...OWN], groups(), 100000);
  assert([...halves.groups.keys()].join(" ") === "f.fsh", "one part");
});
