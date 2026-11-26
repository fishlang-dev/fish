// `fishc demangle`'s reading of symbols in tool output, alone and through a names table.
import {
  demangled,
  helperName,
  namesFrom,
  namesText,
  plainName,
} from "../../src/demangle.fsh";

function same(got: string, want: string): void {
  assert(got === want, `got ${got}, want ${want}`);
}

function table(): Map<string, string> {
  try {
    return namesFrom(
      namesText([
        ["fsh.first#nnl9lf", "first<string>"],
        ["fsh.first#rv34vv", "first<i64>"],
        ["fsh.first#nnl9lf.closure0", "first<string>.closure0"],
        ["fsh.Box<Map<string, i64>>.get#qmkzon", "Box<Map<string, i64>>.get"],
        ["fsh.drop.13syk5vj9doth", helperName("drop Box<string>")],
      ]),
    );
  } catch (e) {
    assert(false, (e as { message: string }).message);
    return new Map<string, string>();
  }
}

test("a symbol reads alone without fsh. and its hashes", () => {
  same(plainName("fsh.boom"), "boom");
  same(plainName("fsh.first#nnl9lf"), "first");
  same(plainName("fsh.first#nnl9lf.1.closure0"), "first.closure0");
  same(plainName("fsh.C.#secret"), "C.#secret");
  same(plainName("fsh.Box<#abc123>.get~k3j4l5"), "Box<#abc123>.get");
});

test("the table names generic instances and helpers", () => {
  const names = table();
  same(
    demangled("  0: fsh.first#nnl9lf at g.fsh:6", names),
    "  0: first<string> at g.fsh:6",
  );
  same(
    demangled("#1 0x10 in fsh.first#rv34vv+0x14", names),
    "#1 0x10 in first<i64>+0x14",
  );
  same(
    demangled("g`fsh.first#nnl9lf.closure0 + 20", names),
    "g`first<string>.closure0 + 20",
  );
  same(
    demangled("000000010002d6dc T _fsh.drop.13syk5vj9doth", names),
    "000000010002d6dc T drop<Box<string>>",
  );
  same(
    demangled("in fsh.Box<Map<string, i64>>.get#qmkzon (g)", names),
    "in Box<Map<string, i64>>.get (g)",
  );
});

test("what the table lacks reads alone, and what isn't a symbol is left", () => {
  const names = table();
  same(
    demangled("fsh.main.closure0, fsh.boom.", names),
    "main.closure0, boom.",
  );
  same(demangled("fsh.first#zzzzzz", names), "first");
  same(
    demangled("src/main.fsh.o and x_fsh.y", names),
    "src/main.fsh.o and x_fsh.y",
  );
  same(demangled("", names), "");
});

test("a names table round-trips text a tab or newline is in", () => {
  let refused = "";
  try {
    const names = namesFrom(namesText([["fsh.f#abcdef", 'f<"a\tb\nc">']]));
    same(names.get("fsh.f#abcdef")!, 'f<"a\tb\nc">');
    namesFrom("not a table\n");
  } catch (e) {
    refused = (e as { message: string }).message;
  }
  assert(refused.includes("fishc names 1"), refused);
});
