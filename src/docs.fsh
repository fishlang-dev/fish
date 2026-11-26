import type { Comment } from "./lexer.fsh";
import type { ClassMember, Pattern, PropertyName, Stmt } from "./parser.fsh";

// Doc comments read from a file's text: the `/** ... */` comment before a declaration, rendered
// for `fishc doc`, and the ```fsh examples in any of them, run by `fishc test`.

// A ```fsh block in a doc comment. `padded` is the file's text with everything but the block's code
// blanked, newlines kept, so the code sits at its own offsets; `closer` is where its closing fence
// starts; `line` is the opening fence's line, from 1; `expect` holds its `// expect:` lines.
export type Example = {
  line: usize;
  padded: string;
  closer: usize;
  expect: string[];
  async: boolean;
};

// Whether a comment is a doc comment, `/** ... */` and not `/**/`.
export function isDoc(c: Ref<Comment>): boolean {
  return c.kind === "block" && c.text.startsWith("/**") && c.text !== "/**/";
}

// A doc comment's lines between its markers, each without its leading `*`.
export function docText(comment: string): string {
  const inner = comment.slice(3, (comment.length - 2) as i64);
  return inner
    .split("\n")
    .map((l) => l.replace(/^\s*\* ?/, ""))
    .join("\n")
    .trim();
}

// The doc comment written just before `at`, with only whitespace between, or undefined.
export function docBefore(
  src: string,
  comments: Ref<Comment[]>,
  at: usize,
): string | undefined {
  for (let k = comments.length; k > 0; k--) {
    const c: Ref<Comment> = comments[k - 1]!;
    if (c.end > at) continue;
    if (!isDoc(c) || src.slice(c.end as i64, at as i64).trim() !== "")
      return undefined;
    return docText(c.text);
  }
  return undefined;
}

function blanked(text: string): string {
  return text.replace(/[^\n]/g, " ");
}

// Every ```fsh block in the doc comments of `src`.
export function examplesIn(src: string, comments: Ref<Comment[]>): Example[] {
  let found: Example[] = [];
  for (const c of comments) {
    if (!isDoc(c)) continue;
    let offset = c.start;
    let open: usize | undefined = undefined;
    let pieces: [usize, usize][] = [];
    let expect: string[] = [];
    for (const line of c.text.split("\n")) {
      const prefix = /^\s*(\/\*\*)?\s*\*?\s?/.exec(line);
      const skip = prefix === null ? 0 : prefix[0]!.length;
      const content = line.slice(skip as i64).replace(/\*\/\s*$/, "");
      const fence = content.trim();
      if (open === undefined && fence === "```fsh") {
        open = offset;
        pieces = [];
        expect = [];
      } else if (open !== undefined && fence === "```") {
        const at = offset + (line.indexOf("```") as usize);
        found.push({
          line: lineOf(src, open!),
          padded: paddedWith(src, pieces),
          closer: at,
          expect: expect.clone(),
          async: pieces.some((p) =>
            /\bawait\b/.test(src.slice(p[0] as i64, p[1] as i64)),
          ),
        });
        open = undefined;
      } else if (open !== undefined) {
        pieces.push([
          offset + skip,
          offset + (skip as usize) + (content.length as usize),
        ]);
        const e = /\/\/ expect: ?(.*)$/.exec(content);
        if (e !== null) expect.push(e[1]!.trimEnd());
      }
      offset += (line.length as usize) + 1;
    }
  }
  return found;
}

function lineOf(src: string, at: usize): usize {
  return src.slice(0, at as i64).split("\n").length as usize;
}

function paddedWith(src: string, pieces: Ref<[usize, usize][]>): string {
  let out = "";
  let from: usize = 0;
  for (const p of pieces) {
    out += blanked(src.slice(from as i64, p[0] as i64));
    out += src.slice(p[0] as i64, p[1] as i64);
    from = p[1];
  }
  return out + blanked(src.slice(from as i64));
}

// The text a doc example is parsed from: a `test(...)` wrapping its code, the wrapper before the
// file's text and its close on the closing fence, which is as long, so the code keeps its offsets
// once the parse is moved back by the wrapper's length. Gives the text and that length.
export function exampleTest(e: Ref<Example>): { text: string; before: usize } {
  const head = `test("", ${e.async ? "async " : ""}() => {`;
  const body =
    e.padded.slice(0, e.closer as i64) +
    "});" +
    e.padded.slice((e.closer + 3) as i64);
  return { text: head + body, before: head.length as usize };
}

// A declaration as `fishc doc` shows it.
export type Documented = {
  kind: string;
  name: string;
  signature: string;
  doc: string;
  members: Documented[];
};

// The exported declarations of a file, with their signatures as written and their doc comments.
export function documented(
  src: string,
  program: Ref<Stmt[]>,
  comments: Ref<Comment[]>,
): Documented[] {
  let out: Documented[] = [];
  for (const s of program) {
    if (s.kind !== "export") continue;
    const doc = docBefore(src, comments, s.start) ?? "";
    const d: Ref<Stmt> = s.body;
    const text = src.slice(s.start as i64, s.end as i64);
    if (d.kind === "function")
      out.push({
        kind: "function",
        name: d.name,
        signature: headOf(text),
        doc,
        members: [],
      });
    else if (d.kind === "class" && d.name !== undefined)
      out.push({
        kind: "class",
        name: d.name!,
        signature: headOf(text),
        doc,
        members: membersOf(src, d.members, comments),
      });
    else if (d.kind === "interface")
      out.push({
        kind: "interface",
        name: d.name,
        signature: text.trim(),
        doc,
        members: [],
      });
    else if (d.kind === "typeAlias")
      out.push({
        kind: "type",
        name: d.name,
        signature: text.trim().replace(/;$/, ""),
        doc,
        members: [],
      });
    else if (d.kind === "enum")
      out.push({
        kind: "enum",
        name: d.name,
        signature: text.trim(),
        doc,
        members: [],
      });
    else if (d.kind === "let" && d.keyword === "const") {
      for (const v of d.declarations) {
        const target: Ref<Pattern> = v.target;
        if (target.kind !== "ident") continue;
        const typed =
          v.type !== undefined
            ? `: ${src.slice(v.type!.start as i64, v.type!.end as i64)}`
            : "";
        out.push({
          kind: "const",
          name: target.name,
          signature: `const ${target.name}${typed}`,
          doc,
          members: [],
        });
      }
    }
  }
  return out;
}

function membersOf(
  src: string,
  members: Ref<ClassMember[]>,
  comments: Ref<Comment[]>,
): Documented[] {
  let out: Documented[] = [];
  for (const m of members) {
    if (m.modifiers.includes("private") || m.modifiers.includes("protected"))
      continue;
    let name = "";
    if (m.kind === "constructor") name = "constructor";
    else if (
      m.kind === "field" ||
      m.kind === "method" ||
      m.kind === "get" ||
      m.kind === "set"
    ) {
      const written: Ref<PropertyName> = m.name;
      if (typeof written === "string") name = written;
    }
    if (name === "" || name.startsWith("#")) continue;
    const text = src.slice(m.start as i64, m.end as i64);
    const signature =
      m.kind === "field"
        ? text
            .trim()
            .replace(/\s*=[\s\S]*$/, "")
            .replace(/;$/, "")
        : headOf(text);
    out.push({
      kind: m.kind,
      name,
      signature,
      doc: docBefore(src, comments, m.start) ?? "",
      members: [],
    });
  }
  return out;
}

// A declaration's text up to the `{` that opens its body: a `{` is a type's when it follows
// `:`, `|`, `&`, `,`, `<`, `(` or `=>`, and the body's otherwise.
export function headOf(text: string): string {
  let depth = 0;
  let types = 0;
  let quote = "";
  let last = "";
  for (let i: usize = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote !== "") {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      last = ch;
      continue;
    }
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "{") {
      if (depth === 0 && types === 0 && !/[:|&,<(]$|=>$/.test(last))
        return text.slice(0, i as i64).trim();
      types++;
    } else if (ch === "}") types--;
    if (ch.trim() !== "") last = last.endsWith("=") && ch === ">" ? "=>" : ch;
  }
  return text.trim().replace(/;$/, "");
}

function escaped(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inline(text: string): string {
  return escaped(text).replace(/`([^`]+)`/g, "<code>$1</code>");
}

// A doc comment as HTML: paragraphs, inline code, fenced blocks, and its tags as a list.
export function rendered(doc: string): string {
  let out = "";
  let paragraph: string[] = [];
  let tags: string[] = [];
  let fenced: string[] = [];
  let inFence = false;
  const flush = (into: string, lines: Ref<string[]>): string =>
    lines.length === 0 ? into : `${into}<p>${inline(lines.join(" "))}</p>\n`;
  for (const line of doc.split("\n")) {
    if (inFence) {
      if (line.trim() === "```") {
        out += `<pre><code>${escaped(fenced.join("\n"))}</code></pre>\n`;
        inFence = false;
      } else fenced.push(line);
      continue;
    }
    if (line.trim().startsWith("```")) {
      out = flush(out, paragraph);
      paragraph = [];
      fenced = [];
      inFence = true;
      continue;
    }
    const tag = /^@(\w+)\s*(.*)$/.exec(line.trim());
    if (tag !== null) {
      out = flush(out, paragraph);
      paragraph = [];
      tags.push(`<li><b>@${escaped(tag[1]!)}</b> ${inline(tag[2]!)}</li>`);
    } else if (line.trim() === "") {
      out = flush(out, paragraph);
      paragraph = [];
    } else paragraph.push(line.trim());
  }
  out = flush(out, paragraph);
  if (tags.length > 0) out += `<ul class="tags">\n${tags.join("\n")}\n</ul>\n`;
  return out;
}

const STYLE =
  "body{font:15px/1.5 system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;color:#222}pre{background:#f4f4f4;padding:.6rem;overflow:auto}code{font-family:ui-monospace,monospace}.item{border-top:1px solid #ddd;padding:.6rem 0}.kind{color:#777;font-size:.85em}.member{margin-left:1.5rem}@media(prefers-color-scheme:dark){body{background:#161616;color:#ddd}pre{background:#222}}";

function page(title: string, body: string): string {
  return `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escaped(title)}</title><style>${STYLE}</style></head><body>\n${body}</body></html>\n`;
}

function itemHtml(d: Ref<Documented>, member: boolean): string {
  const id = member ? "" : ` id="${escaped(d.name)}"`;
  let html = `<div class="${member ? "member" : "item"}"${id}><span class="kind">${escaped(d.kind)}</span><pre><code>${escaped(d.signature)}</code></pre>\n${rendered(d.doc)}`;
  for (const m of d.members) html += itemHtml(m, true);
  return `${html}</div>\n`;
}

// A module's page: each documented declaration in order.
export function modulePage(file: string, items: Ref<Documented[]>): string {
  let body = `<p><a href="index.html">index</a></p>\n<h1>${escaped(file)}</h1>\n`;
  for (const d of items) body += itemHtml(d, false);
  return page(file, body);
}

// The file a module's page is written to.
export function pageName(file: string): string {
  return `${file.replace(/\.fsh$/, "").replace(/[^A-Za-z0-9_-]/g, "_")}.html`;
}

// The index: every module, and a search over every declaration's name.
export function indexPage(
  title: string,
  modules: Ref<{ file: string; items: Documented[] }[]>,
): string {
  let entries: string[] = [];
  let list = "";
  for (const m of modules) {
    list += `<li><a href="${pageName(m.file)}">${escaped(m.file)}</a></li>\n`;
    for (const d of m.items)
      entries.push(
        `[${JSON.stringify(d.name)},${JSON.stringify(d.kind)},${JSON.stringify(`${pageName(m.file)}#${d.name}`)}]`,
      );
  }
  const script = `const all=[${entries.join(",")}];const q=document.getElementById("q"),r=document.getElementById("r");q.oninput=()=>{const t=q.value.toLowerCase();r.innerHTML="";if(!t)return;for(const [n,k,u] of all)if(n.toLowerCase().includes(t)){const li=document.createElement("li");const a=document.createElement("a");a.href=u;a.textContent=n+" ("+k+")";li.append(a);r.append(li)}};`;
  const body = `<h1>${escaped(title)}</h1>\n<input id="q" placeholder="Search" aria-label="Search">\n<ul id="r"></ul>\n<h2>Modules</h2>\n<ul>\n${list}</ul>\n<script>${script}</script>\n`;
  return page(title, body);
}
