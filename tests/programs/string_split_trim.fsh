function main() {
  const texts: string[] = ["a,b,,c", ",a,", "", "a😀b😀c", "no-sep", "😀", "x  y z"];
  const seps: string[] = [",", "", "😀", "\uDE00", "zz", " ", "a,"];
  const limits: usize[] = [0, 1, 2, 100];
  let lines: string[] = [];
  for (const t of texts) {
    let line = `[${t.split().length}]`;
    for (const s of seps) {
      const parts = t.split(s);
      let joined = "";
      for (const p of parts) joined += `<${p}>`;
      line += ` ${parts.length}${joined}`;
      for (const l of limits) line += `/${t.split(s, l).length}`;
    }
    lines.push(line);
  }
  const spaces: string[] = [" \t\n x \r\n", "  y　﻿", "z", "", "   ", " a b "];
  for (const s of spaces) {
    const a = s.trim();
    const b = s.trimStart();
    const c = s.trimEnd();
    lines.push(`${a.length} ${b.length} ${c.length} ${a.length > 0 ? a.charCodeAt(0) : 0} ${b.length > 0 ? b.charCodeAt(b.length - 1) : 0} ${c.length > 0 ? c.charCodeAt(0) : 0}`);
  }
  for (const l of lines) console.log(l);
}
// expect: [1] 4<a><b><><c>/0/1/2/4 6<a><,><b><,><,><c>/0/1/2/6 1<a,b,,c>/0/1/1/1 1<a,b,,c>/0/1/1/1 1<a,b,,c>/0/1/1/1 1<a,b,,c>/0/1/1/1 2<><b,,c>/0/1/2/2
// expect: [1] 3<><a><>/0/1/2/3 3<,><a><,>/0/1/2/3 1<,a,>/0/1/1/1 1<,a,>/0/1/1/1 1<,a,>/0/1/1/1 1<,a,>/0/1/1/1 2<,><>/0/1/2/2
// expect: [1] 1<>/0/1/1/1 0/0/0/0/0 1<>/0/1/1/1 1<>/0/1/1/1 1<>/0/1/1/1 1<>/0/1/1/1 1<>/0/1/1/1
// expect: [1] 1<a😀b😀c>/0/1/1/1 7<a><�><�><b><�><�><c>/0/1/2/7 3<a><b><c>/0/1/2/3 3<a�><b�><c>/0/1/2/3 1<a😀b😀c>/0/1/1/1 1<a😀b😀c>/0/1/1/1 1<a😀b😀c>/0/1/1/1
// expect: [1] 1<no-sep>/0/1/1/1 6<n><o><-><s><e><p>/0/1/2/6 1<no-sep>/0/1/1/1 1<no-sep>/0/1/1/1 1<no-sep>/0/1/1/1 1<no-sep>/0/1/1/1 1<no-sep>/0/1/1/1
// expect: [1] 1<😀>/0/1/1/1 2<�><�>/0/1/2/2 2<><>/0/1/2/2 2<�><>/0/1/2/2 1<😀>/0/1/1/1 1<😀>/0/1/1/1 1<😀>/0/1/1/1
// expect: [1] 1<x  y z>/0/1/1/1 6<x>< >< ><y>< ><z>/0/1/2/6 1<x  y z>/0/1/1/1 1<x  y z>/0/1/1/1 1<x  y z>/0/1/1/1 4<x><><y><z>/0/1/2/4 1<x  y z>/0/1/1/1
// expect: 1 4 5 120 10 32
// expect: 1 3 3 121 65279 160
// expect: 1 1 1 122 122 122
// expect: 0 0 0 0 0 0
// expect: 0 0 0 0 0 0
// expect: 3 4 4 97 8287 8195
