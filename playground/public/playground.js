// The page: the editor, the compiler's answer shown beside it, and share links.
const editor = document.getElementById("source");
const output = document.getElementById("output");
const problems = document.getElementById("problems");
const explain = document.getElementById("explain");
const status = document.getElementById("status");
const link = document.getElementById("link");
const worker = new Worker("worker.js");

const SAMPLE = `function longest(a: string, b: string): string {
  return a.length >= b.length ? a : b;
}

function main() {
  const words = ["fish", "ownership", "native"];
  let best = "";
  for (const w of words) best = longest(best, w);
  console.log("the longest word is", best);
}
`;

// The offset in the editor's text of a 1-based line and column.
function offset(line, col) {
  const lines = editor.value.split("\n");
  let at = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) at += lines[i].length + 1;
  return at + col - 1;
}

function show(answer) {
  problems.replaceChildren();
  for (const d of answer.diagnostics) {
    const item = document.createElement("li");
    item.className = d.severity;
    const place = document.createElement("button");
    place.textContent = `${d.line}:${d.col}`;
    place.title = "show it in the program";
    place.onclick = () => {
      editor.focus();
      editor.setSelectionRange(offset(d.line, d.col), Math.max(offset(d.endLine, d.endCol), offset(d.line, d.col) + 1));
    };
    item.append(place, ` ${d.severity}[${d.code}]: ${d.message}`);
    problems.append(item);
  }
  explain.textContent = answer.explain;
  output.textContent = answer.output.join("\n");
  const errors = answer.diagnostics.filter((d) => d.severity === "error").length;
  status.textContent = errors > 0 ? `${errors} error${errors === 1 ? "" : "s"}` : answer.ran ? "ran" : answer.note;
  if (answer.note !== "" && errors === 0 && answer.ran === false) output.textContent += (output.textContent === "" ? "" : "\n") + `(${answer.note})`;
}

let busy = false;
function run() {
  if (busy) return;
  busy = true;
  status.textContent = "checking";
  worker.postMessage({ source: editor.value });
}

worker.onmessage = (event) => {
  busy = false;
  if (event.data.failure !== undefined) {
    status.textContent = "the compiler failed";
    output.textContent = event.data.failure;
    return;
  }
  show(event.data.answer);
};

async function share() {
  const res = await fetch("api/share", { method: "POST", body: editor.value });
  if (!res.ok) {
    status.textContent = await res.text();
    return;
  }
  const { id } = await res.json();
  const url = new URL(location.href);
  url.search = `?s=${id}`;
  history.replaceState(null, "", url);
  link.value = url.href;
  link.hidden = false;
  link.select();
}

async function load() {
  const id = new URLSearchParams(location.search).get("s");
  if (id === null || !/^[0-9a-f]{12}$/.test(id)) {
    editor.value = SAMPLE;
    return;
  }
  const res = await fetch(`api/share/${id}`);
  editor.value = res.ok ? await res.text() : `// ${await res.text()}`;
}

document.getElementById("run").onclick = run;
document.getElementById("share").onclick = share;
editor.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    run();
  } else if (e.key === "Tab") {
    e.preventDefault();
    editor.setRangeText("  ", editor.selectionStart, editor.selectionEnd, "end");
  }
});
load().then(run);
