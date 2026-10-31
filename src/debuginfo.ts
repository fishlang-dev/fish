// DWARF line tables for a `-g` build, added to codegen's IR after the fact. Codegen marks each of
// the program's own functions with `;fsh.fn <offset>` as its first line, and each change of the
// source it is lowering with `;fsh.at <offset>`, offsets into the program's sources. Each marked
// function gets a `DISubprogram`, and each of its instructions the `DILocation` of the last mark
// before it, so debuggers step through `.fsh` lines. Nothing else in the module is touched.

import { resolve, basename, dirname } from "node:path";
import { sourceOf, type Source } from "./diag.ts";

const FN = /^ {2};fsh\.fn (\d+)$/;
const AT = /^ {2};fsh\.at (\d+)$/;

// A metadata string, its quotes and backslashes escaped as LLVM spells them.
const quoted = (text: string) => `"${text.replace(/["\\]/g, (c) => `\\${c.charCodeAt(0).toString(16).toUpperCase()}`)}"`;

// `file`, `line` and `col` of each offset into the program, through a table of each source's line
// starts, since a function's every expression is looked up.
function placer(src: string, file: string, sources: Source[]) {
  const starts = new Map<string, number[]>();
  return (offset: number) => {
    const place = sourceOf(src, file, offset, sources);
    let table = starts.get(place.src);
    if (!table) {
      table = [0];
      for (let i = place.src.indexOf("\n"); i >= 0; i = place.src.indexOf("\n", i + 1)) table.push(i + 1);
      starts.set(place.src, table);
    }
    let [lo, hi] = [0, table.length - 1];
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (table[mid]! <= place.offset) lo = mid;
      else hi = mid - 1;
    }
    return { file: place.file, line: lo + 1, col: place.offset - table[lo]! + 1 };
  };
}

// `ir` with the line tables its marks call for, and the marks gone. `optimized` for a release build.
export function withDebugInfo(ir: string, src: string, file: string, sources: Source[], optimized: boolean): string {
  const place = placer(src, file, sources);
  const meta: string[] = [];
  const node = (text: string) => `!${meta.push(text) - 1}`;
  const unit = node("");
  const flags = `!{${node('!{i32 7, !"Dwarf Version", i32 4}')}, ${node('!{i32 2, !"Debug Info Version", i32 3}')}}`;
  const signature = node("!DISubroutineType(types: !{})");
  const files = new Map<string, string>();
  const fileNode = (path: string) => {
    const full = resolve(path);
    if (!files.has(full)) files.set(full, node(`!DIFile(filename: ${quoted(basename(full))}, directory: ${quoted(dirname(full))})`));
    return files.get(full)!;
  };
  const entry = fileNode(file);
  meta[Number(unit.slice(1))] = `distinct !DICompileUnit(language: DW_LANG_C, file: ${entry}, producer: "fishc", isOptimized: ${optimized}, runtimeVersion: 0, emissionKind: LineTablesOnly)`;

  const lines = ir.split("\n");
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const marked = line.startsWith("define ") ? FN.exec(lines[i + 2] ?? "") : undefined;
    if (!marked) {
      result.push(line);
      continue;
    }
    const start = place(Number(marked[1]));
    const name = /@"fsh\.((?:[^"\\]|\\.)*)"\(/.exec(line)?.[1] ?? "";
    const scope = fileNode(start.file);
    const subprogram = node(`distinct !DISubprogram(name: "${name}", linkageName: "fsh.${name}", scope: ${scope}, file: ${scope}, line: ${start.line}, type: ${signature}, scopeLine: ${start.line}, spFlags: DISPFlagDefinition${optimized ? " | DISPFlagOptimized" : ""}, unit: ${unit})`);
    const locations = new Map<string, string>();
    const at = (l: number, c: number) => {
      const key = `${l}:${c}`;
      if (!locations.has(key)) locations.set(key, node(`!DILocation(line: ${l}, column: ${c}, scope: ${subprogram})`));
      return locations.get(key)!;
    };
    let here = at(start.line, start.col);
    result.push(line.replace(/ \{$/, ` !dbg ${subprogram} {`));
    for (i++; lines[i] !== "}"; i++) {
      const text = lines[i]!;
      if (FN.test(text)) continue;
      const moved = AT.exec(text);
      if (moved) {
        // A mark in another file, such as a default value written at its declaration, keeps the
        // line it follows, since a location's file is its function's.
        const to = place(Number(moved[1]));
        if (to.file === start.file) here = at(to.line, to.col);
        continue;
      }
      result.push(text.startsWith("  ") ? `${text}, !dbg ${here}` : text);
    }
    result.push("}");
  }
  const tail = result.at(-1) === "" ? result.pop() : undefined;
  result.push("", `!llvm.dbg.cu = !{${unit}}`, `!llvm.module.flags = ${flags}`, ...meta.map((text, n) => `!${n} = ${text}`));
  if (tail !== undefined) result.push(tail);
  return result.join("\n");
}
