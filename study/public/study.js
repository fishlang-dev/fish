// The study's page: consent, then each task's Rust program beside its Fish translation, compiled
// by the playground's compiler in a worker. With consent, each start, compile, solve and give-up
// is sent to the server; without it, nothing is.
const $ = (id) => document.getElementById(id);
const worker = new Worker("/compiler/worker.js", { type: "module" });
let tasks = [];
let session = null;
let current = null;
let startedAt = 0;
let busy = false;

async function record(kind, codes = []) {
  if (session === null || current === null) return;
  const body = { session, task: current.id, kind, codes, ms: Math.round(performance.now() - startedAt) };
  try {
    await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    // A lost event costs the study a data point, never the participant their task.
  }
}

function showTasks() {
  $("consent").hidden = true;
  $("task").hidden = true;
  $("list").hidden = false;
  const list = $("tasks");
  list.replaceChildren();
  tasks.forEach((t) => {
    const item = document.createElement("li");
    const open = document.createElement("button");
    open.textContent = t.title;
    open.onclick = () => openTask(t);
    item.append(open, ` ${t.goal}`);
    list.append(item);
  });
}

function openTask(t) {
  current = t;
  startedAt = performance.now();
  $("list").hidden = true;
  $("task").hidden = false;
  $("title").textContent = t.title;
  $("goal").textContent = t.goal;
  $("rust").textContent = t.rust;
  $("source").value = t.fish;
  $("output").textContent = "";
  $("problems").replaceChildren();
  $("verdict").textContent = "";
  record("start");
}

function show(answer) {
  const problems = $("problems");
  problems.replaceChildren();
  for (const d of answer.diagnostics) {
    const item = document.createElement("li");
    item.className = d.severity;
    item.textContent = `${d.line}:${d.col} ${d.severity}[${d.code}]: ${d.message}`;
    problems.append(item);
  }
  const printed = answer.output.join("\n");
  $("output").textContent = printed + (answer.note !== "" ? `${printed === "" ? "" : "\n"}(${answer.note})` : "");
  const codes = answer.diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
  record("compile", codes.slice(0, 20));
  if (codes.length === 0 && answer.ran && printed.trim() === current.expect) {
    $("verdict").textContent = "Solved: it prints what the Rust program prints.";
    record("solved");
  } else if (codes.length === 0 && answer.ran) {
    $("verdict").textContent = `It runs, but the Rust program prints: ${current.expect}`;
  }
}

// The worker can't start when the playground's compiler isn't built.
worker.onerror = () => {
  busy = false;
  $("verdict").textContent = "the compiler isn't here: build it with 'fishc run scripts/playground.fsh'";
};

worker.onmessage = (event) => {
  busy = false;
  if (event.data.failure !== undefined) $("output").textContent = event.data.failure;
  else show(event.data.answer);
};

function run() {
  if (busy) return;
  busy = true;
  $("verdict").textContent = "checking";
  worker.postMessage({ source: $("source").value });
}

async function begin(agreed) {
  if (agreed) {
    const res = await fetch("/api/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ consent: true }) });
    if (res.ok) session = (await res.json()).id;
  }
  showTasks();
}

$("agree").onclick = () => begin(true);
$("decline").onclick = () => begin(false);
$("run").onclick = run;
$("back").onclick = showTasks;
$("giveup").onclick = () => {
  record("giveup");
  $("source").value = current.solution;
  $("verdict").textContent = "Here is a translation that compiles; run it to see why.";
};
$("source").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    run();
  }
});
fetch("/api/tasks").then((r) => r.json()).then((all) => { tasks = all; });
