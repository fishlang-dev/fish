// Which retain and release pairs codegen's IR does without, on hand-written functions.
import { elided } from "../../src/elide.fsh";
import { same } from "./support.fsh";

// A string parameter stored into a field: the copy into the field and the drop of the local
// cancel, the local's last use being the copy.
const MOVED = [
  "  %s.0 = alloca ptr",
  "  store ptr %\"s.arg\", ptr %s.0",
  "  %t0 = load ptr, ptr %s.0",
  "  call void @fsh_rt_str_retain(ptr %t0)",
  "  %t1 = getelementptr %\"<C>\", ptr %this, i32 0, i32 0",
  "  %t2 = load ptr, ptr %t1",
  "  store ptr %t0, ptr %t1",
  "  call void @fsh_rt_str_release(ptr %t2)",
  "  %t3 = load ptr, ptr %s.0",
  "  store ptr zeroinitializer, ptr %s.0",
  "  call void @fsh_rt_str_release(ptr %t3)",
  "  ret void",
];

function shown(lines: Ref<string[]>): string {
  return lines.join("\n");
}

test("elision drops the retain and release a local's last copy and drop cancel", () => {
  const want = MOVED.filter((l) => l !== "  call void @fsh_rt_str_retain(ptr %t0)" && l !== "  call void @fsh_rt_str_release(ptr %t3)");
  same(shown(elided([...MOVED])), shown(want), "the moved string");
  const dbg = MOVED.map((l) => (l.includes("call void") ? `${l}, !dbg !7` : l));
  same(shown(elided([...dbg])), shown(dbg.filter((l) => !l.includes("_retain(") && !l.includes("release(ptr %t3)"))), "with line locations");
  const big = MOVED.map((l) => l.replace("fsh_rt_str_retain", "fsh_rt_big_retain").replace("str_release(ptr %t3)", "big_release(ptr %t3)"));
  same(String(elided([...big]).length), String(big.length - 2), "a bigint");
});

test("elision keeps the pair when the slot is read again, escapes, is read after a call, or an invoke or block end comes between", () => {
  const cases: [string, string[]][] = [
    ["read again", [...MOVED.slice(0, 8), "  %t9 = load ptr, ptr %s.0", "  call void @print(ptr %t9)", ...MOVED.slice(8)]],
    ["address passed on", [...MOVED.slice(0, 8), "  call void @f(ptr %s.0)", ...MOVED.slice(8)]],
    ["an invoke between", [...MOVED.slice(0, 8), "  invoke void @f() to label %ok unwind label %pad", ...MOVED.slice(8)]],
    ["another block", [...MOVED.slice(0, 8), "  br label %next", "next:", ...MOVED.slice(8)]],
    ["slot written between", [...MOVED.slice(0, 8), "  store ptr %other, ptr %s.0", ...MOVED.slice(8)]],
    ["the copy read after a call", [...MOVED.slice(0, 8), "  call void @f(ptr %t0)", ...MOVED.slice(8)]],
    ["a release of another value", [...MOVED.slice(0, 10), "  call void @fsh_rt_str_release(ptr %t2)", "  ret void"]],
  ];
  for (const [what, lines] of cases) same(shown(elided([...lines])), shown(lines), what);
});
