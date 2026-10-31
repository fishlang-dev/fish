// DWARF line tables for a `-g` build, added to codegen's IR after the fact. Codegen marks each of
// the program's own functions with `;fsh.fn <offset>` as its first line, and each change of the
// source it is lowering with `;fsh.at <offset>`, offsets into the program's sources. Each marked
// function gets a `DISubprogram`, and each of its instructions the `DILocation` of the last mark
// before it, so debuggers step through `.fsh` lines. Nothing else in the module is touched.

import { resolve, basename, dirname } from "node:path";

// One of the program's files other than the entry, as `diag.ts` has it, written out so this file
// checks with Fish while `diag.ts` doesn't yet.
type Source = { base: number; src: string; file: string };

const FN = /^ {2};fsh\.fn (\d+)$/;
const AT = /^ {2};fsh\.at (\d+)$/;

// A metadata string, its quotes and backslashes escaped as LLVM spells them.
function quoted(text: string): string {
  return `"${text.replaceAll("\\", "\\5C").replaceAll('"', "\\22")}"`;
}

// Where each line of `text` starts, then a start past its end, so every offset has a next one: a
// table, since a function's every expression is looked up.
function lineStarts(text: string): number[] {
  let starts: number[] = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push((i + 1) as number);
  starts.push((text.length + 1) as number);
  return starts;
}

// `ir` with the line tables its marks call for, and the marks gone. `optimized` for a release build.
export function withDebugInfo(ir: string, src: string, file: string, sources: Source[], optimized: boolean): string {
  // The entry's source, then each other file's in order of where its offsets start.
  const regions = [{ base: 0, file, starts: lineStarts(src) }, ...sources.map((s) => ({ base: s.base, file: s.file, starts: lineStarts(s.src) }))];
  // `file`, `line` and `col` of an offset into the program.
  const place = (offset: number): { file: string; line: number; col: number } => {
    const after = regions.findIndex((r) => r.base > offset);
    const region = after < 0 ? regions.at(-1)! : regions.at(after - 1)!;
    const at = offset - region.base;
    const next = region.starts.findIndex((start) => start > at);
    return { file: region.file, line: next as number, col: at - region.starts.at(next - 1)! + 1 };
  };
  const fileText = (path: string): string => `!DIFile(filename: ${quoted(basename(path))}, directory: ${quoted(dirname(path))})`;
  // The unit, its module flags, the one signature every subprogram has, and the entry's file.
  let meta: string[] = [
    `distinct !DICompileUnit(language: DW_LANG_C, file: !4, producer: "fishc", isOptimized: ${optimized}, runtimeVersion: 0, emissionKind: LineTablesOnly)`,
    '!{i32 7, !"Dwarf Version", i32 4}',
    '!{i32 2, !"Debug Info Version", i32 3}',
    "!DISubroutineType(types: !{})",
    fileText(resolve(file)),
  ];
  const [unit, flags, signature] = ["!0", "!{!1, !2}", "!3"];
  const node = (text: string): string => {
    meta.push(text);
    return `!${meta.length - 1}`;
  };
  let files = new Map<string, string>([[resolve(file), "!4"]]);
  const fileNode = (path: string): string => {
    const full = resolve(path);
    if (!files.has(full)) files.set(full, node(fileText(full)));
    return files.get(full)!;
  };

  let result: string[] = [];
  // A function's `define` line and `entry:` label are held until the line after says whether it
  // is marked. In a marked function, `subprogram` is its node, `home` its file and `here` the
  // location its next instruction gets.
  let [header, label, subprogram, home, here] = ["", "", "", "", ""];
  let locations = new Map<string, string>();
  const at = (line: number, col: number, scope: string): string => {
    const key = `${scope}:${line}:${col}`;
    if (!locations.has(key)) locations.set(key, node(`!DILocation(line: ${line}, column: ${col}, scope: ${scope})`));
    return locations.get(key)!;
  };
  for (const line of ir.split("\n")) {
    if (line.startsWith("define ")) header = line;
    else if (header !== "" && label === "") label = line;
    else if (header !== "") {
      const marked = FN.exec(line);
      if (marked === null) {
        result.push(header);
        result.push(label);
        result.push(line);
      } else {
        const start = place(Number(marked[1])!);
        // Codegen escapes a quote in a symbol, so the first `"(` ends its name.
        const name = header.slice(header.indexOf('@"fsh.') + 6, header.indexOf('"('));
        const scope = fileNode(start.file);
        subprogram = node(`distinct !DISubprogram(name: "${name}", linkageName: "fsh.${name}", scope: ${scope}, file: ${scope}, line: ${start.line}, type: ${signature}, scopeLine: ${start.line}, spFlags: DISPFlagDefinition${optimized ? " | DISPFlagOptimized" : ""}, unit: ${unit})`);
        home = start.file;
        here = at(start.line, start.col, subprogram);
        result.push(header.replace(/ \{$/, ` !dbg ${subprogram} {`));
        result.push(label);
      }
      [header, label] = ["", ""];
    } else if (subprogram === "" || !line.startsWith("  ")) {
      if (line === "}") subprogram = "";
      result.push(line);
    } else {
      const moved = AT.exec(line);
      if (moved === null) result.push(`${line}, !dbg ${here}`);
      else {
        // A mark in another file, such as a default value written at its declaration, keeps the
        // line it follows, since a location's file is its function's.
        const to = place(Number(moved[1])!);
        if (to.file === home) here = at(to.line, to.col, subprogram);
      }
    }
  }
  const numbered = meta.map((text, n) => `!${n} = ${text}\n`).join("");
  return `${result.join("\n")}\n!llvm.dbg.cu = !{${unit}}\n!llvm.module.flags = ${flags}\n${numbered}`;
}
