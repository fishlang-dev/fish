// `fishc bloat`'s reading of IR text and of `nm -n` output, and how it groups instances.
import { binaryFunctions, bloat, formatBloat, groupOf, irFunctions } from "../../src/bloat.fsh";

function same(got: string, want: string): void {
  assert(got === want, `got ${got}, want ${want}`);
}

function ir(): string {
  return [
    "%T = type { i64 }",
    'define internal i64 @"fsh.id#rv34vv"(i64 %x.arg) {',
    "entry:",
    "  ret i64 %x.arg",
    "}",
    "",
    'define internal ptr @"fsh.id#0sdgx7"(ptr %x.arg) {',
    "entry:",
    "  ret ptr %x.arg",
    "}",
    "",
    "define internal void @fsh.drop.13syk5vj9doth(ptr %p) {",
    "entry:",
    "  ret void",
    "}",
    "",
    'define internal void @"fsh.main"() {',
    "entry:",
    "  ret void",
    "}",
    "",
  ].join("\n");
}

test("each define is measured to its closing brace", () => {
  const fns = irFunctions(ir());
  same(fns.map((f) => f.name).join("|"), ['"fsh.id#rv34vv"', '"fsh.id#0sdgx7"', "fsh.drop.13syk5vj9doth", '"fsh.main"'].join("|"));
  // Its define line, `entry:`, the `ret` and the brace, each with its newline.
  same(`${fns[3]!.bytes}`, `${37 + 7 + 11 + 2}`);
});

test("instances group by their body, helpers by their family", () => {
  same(groupOf('"fsh.id#rv34vv"'), "fsh.id");
  same(groupOf('"fsh.Box<Map<string, i64>>.get#nnl9lf"'), "fsh.Box.get");
  same(groupOf('"fsh.f#ja329j.2.closure1"'), "fsh.f.closure1");
  same(groupOf('"fsh.C.#count"'), "fsh.C.#count");
  same(groupOf('"fsh.apply<(x: i64) => i64>#abc123"'), "fsh.apply");
  same(groupOf('"fsh.walk~1a2b3c"'), "fsh.walk");
  same(groupOf("fsh.drop.13syk5vj9doth"), "fsh.drop.*");
  same(groupOf("main"), "main");
});

test("a report sums each group and leaves out functions that are their own", () => {
  const b = bloat("IR text", irFunctions(ir()));
  same(b.groups.map((g) => `${g.name} ${g.instances}`).join("|"), ["fsh.id 2", "fsh.drop.* 1"].join("|"));
  same(`${b.total}`, `${b.functions.reduce((n, f) => n + f.bytes, 0)}`);
  same(formatBloat(b, 1).split("\n")[0]!, `${b.total} bytes of IR text in 4 functions, 2 generic bodies and helper families`);
});

test("a binary's code symbols are sized to the next symbol", () => {
  const nm = ["0000000100000000 T __mh_execute_header", "00000001000008f0 T _fsh.Response.text", "000000010000093c t _fsh.drop.13syk5vj9doth", "0000000100000a00 D _data", "0000000100000b00 T _last", ""].join("\n");
  const fns = binaryFunctions(nm);
  same(fns.map((f) => `${f.name} ${f.bytes}`).join("|"), ["_mh_execute_header 2288", '"fsh.Response.text" 76', "fsh.drop.13syk5vj9doth 196"].join("|"));
});
