import { readFileSync } from "node:fs";
import { featureOf, featuresOf, scanFiles, type FileScan } from "./survey.ts";

// `fishc survey --rank`: which Fish features to build first. A file is portable once every
// feature it waits on exists; the curve picks, one at a time, the feature that makes the most
// lines portable, so its order is the order to build in and its shares say how fast that goes.

export type Share = { files: usize; lines: usize; share: f64 };
export type Step = {
  feature: string; rules: string[]; plan?: { item: string; done: boolean } | null;
  files: usize; lines: usize; gained: { files: usize; lines: usize }; portable: Share;
};
// A file that can't be read stays out of the steps, since what else it waits on is unknown, but
// its lines stay in every share, and `unread` lists them by what they are known to wait on.
export type Curve = { start: Share; steps: Step[]; unread: { feature: string; files: usize; lines: usize }[] };
export type Repo = { dir: string; files: usize; lines: usize; unread: { files: usize; lines: usize } };
export type Ranking = { repos: Repo[]; curve: Curve; self?: { dir: string; curve: Curve } };

export type Unit = { lines: usize; waits: Set<string>; rules: [string, string][] };
export type Plan = Map<string, { item: string; done: boolean }>;

/** @throws {Error | IoError} */
export function rank(dirs: Ref<string[]>, self?: string, plan?: Plan): Ranking {
  let repos: Repo[] = [];
  let all: FileScan[] = [];
  for (const dir of dirs) {
    let scans = scanFiles(dir);
    let read: { files: usize; lines: usize } = { files: 0, lines: 0 };
    let unread: { files: usize; lines: usize } = { files: 0, lines: 0 };
    for (const f of scans) {
      if (f.read) {
        read.files++;
        read.lines += f.lines;
      } else {
        unread.files++;
        unread.lines += f.lines;
      }
    }
    repos.push({ dir, files: read.files, lines: read.lines, unread });
    while (scans.length > 0) all.push(scans.shift()!);
  }
  let ranking: Ranking = { repos, curve: curveOf(all, plan) };
  if (self !== undefined) ranking.self = { dir: self, curve: curveOf(scanFiles(self), plan) };
  return ranking;
}

function unit(f: Ref<FileScan>): Unit {
  let rules: [string, string][] = [];
  for (const [id, example] of f.findings) {
    const feature = featureOf(id, example.module);
    rules.push([id, feature !== undefined ? feature : ""]);
  }
  return { lines: f.lines, waits: new Set(featuresOf(f)), rules };
}

function curveOf(scans: Ref<FileScan[]>, plan: Ref<Plan | undefined>): Curve {
  let units: Unit[] = [];
  let total: usize = 0;
  for (const f of scans) {
    total += f.lines;
    if (f.read) units.push(unit(f));
  }
  const { start, steps } = stepsOf(units, total, plan);
  let unread = new Map<string, { files: usize; lines: usize }>();
  for (const f of scans) {
    if (f.read) continue;
    const waits = featuresOf(f);
    const feature = waits.length > 0 ? waits[0]! : "files that couldn't be opened";
    const had = unread.get(feature);
    unread.set(feature, had !== undefined ? { files: had.files + 1, lines: had.lines + f.lines } : { files: 1, lines: f.lines });
  }
  let listed: { feature: string; files: usize; lines: usize }[] = [];
  for (const [feature, n] of unread) listed.push({ feature, files: n.files, lines: n.lines });
  listed.sort((a, b) => (b.lines as i64) - (a.lines as i64));
  return { start, steps, unread: listed };
}

function sum(units: Ref<Unit[]>, at: Ref<usize[]>): usize {
  let n: usize = 0;
  for (const i of at) n += units[i]!.lines;
  return n;
}

// A unit's features not picked yet.
function needs(u: Ref<Unit>, picked: Ref<Set<string>>): string[] {
  let out: string[] = [];
  for (const w of u.waits) if (!picked.has(w)) out.push(w);
  return out;
}

// The open units that `w` is all that is left for.
function freed(units: Ref<Unit[]>, open: Ref<usize[]>, picked: Ref<Set<string>>, w: string): usize[] {
  let out: usize[] = [];
  for (const i of open) if (needs(units[i]!, picked).every((x) => x === w)) out.push(i);
  return out;
}

// How much of what still waits `w` carries, each file's lines shared among the features it still
// needs; rounded so float noise can't beat the name.
function carried(units: Ref<Unit[]>, open: Ref<usize[]>, picked: Ref<Set<string>>, w: string): f64 {
  let n: f64 = 0;
  for (const i of open) {
    const u: Ref<Unit> = units[i]!;
    if (u.waits.has(w)) n += (u.lines as f64) / (needs(u, picked).length as f64);
  }
  return Math.round(n * 1e6);
}

// The share of every line surveyed that `lines` is, rounded down, so 100% means every line,
// unread ones included.
function share(files: usize, lines: usize, total: usize): Share {
  return { files, lines, share: total === 0 ? 0 : Math.floor(((lines * 1000) as f64) / (total as f64)) / 10 };
}

// The steps over files already read, each a unit of lines waiting on features; `total` counts
// every line surveyed, unread ones too.
export function stepsOf(units: Ref<Unit[]>, total: usize, plan: Ref<Plan | undefined>): { start: Share; steps: Step[] } {
  let picked = new Set<string>();
  let open: usize[] = [];
  for (let i: usize = 0; i < units.length; i++) if (units[i]!.waits.size > 0) open.push(i);
  let every: usize[] = [];
  for (let i: usize = 0; i < units.length; i++) every.push(i);
  let portable = { files: units.length - open.length, lines: sum(units, every) - sum(units, open) };
  const start = share(portable.files, portable.lines, total);
  let steps: Step[] = [];
  while (open.length > 0) {
    let remaining = new Set<string>();
    for (const i of open) for (const w of needs(units[i]!, picked)) remaining.add(w);
    // Ties, and steps that free nothing yet, go to the feature carrying most of what still
    // waits.
    let scored: { w: string; gain: usize; weight: f64 }[] = [];
    for (const w of remaining) scored.push({ w, gain: sum(units, freed(units, open, picked, w)), weight: carried(units, open, picked, w) });
    scored.sort((a, b) => (a.gain !== b.gain ? (b.gain as i64) - (a.gain as i64) : a.weight !== b.weight ? (b.weight > a.weight ? 1 : -1) : a.w < b.w ? -1 : 1));
    const best = scored[0]!.w;
    let users: usize[] = [];
    for (const i of open) if (units[i]!.waits.has(best)) users.push(i);
    const gained = freed(units, open, picked, best);
    picked.add(best);
    open = open.filter((i) => !gained.includes(i));
    portable = { files: portable.files + gained.length, lines: portable.lines + sum(units, gained) };
    let rules = new Set<string>();
    for (const u of units) for (const [id, f] of u.rules) if (f === best) rules.add(id);
    let sorted = [...rules];
    sorted.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const gainedShare = { files: gained.length, lines: sum(units, gained) };
    const after = share(portable.files, portable.lines, total);
    if (plan !== undefined) {
      const item = plan.get(best.toLowerCase());
      steps.push({ feature: best, rules: sorted, plan: item !== undefined ? item : null, files: users.length, lines: sum(units, users), gained: gainedShare, portable: after });
    } else steps.push({ feature: best, rules: sorted, files: users.length, lines: sum(units, users), gained: gainedShare, portable: after });
  }
  return { start, steps };
}

const PLAN_ITEM = /^\s*- \[([ xX])\]\s+(\w+)\.\s+\*\*(.+?)\*\*/;

// The plan's items by title, ignoring case and backticks: each `- [ ] N. **Title**` line, ticked
// or not, the first of any titles written twice.
/** @throws {Error | IoError} */
export function readPlan(path: string): Plan {
  let plan: Plan = new Map<string, { item: string; done: boolean }>();
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const m = PLAN_ITEM.exec(line);
    if (m === null) continue;
    const title = m[3]!.replaceAll("`", "").toLowerCase();
    if (!plan.has(title)) plan.set(title, { item: m[2]!, done: m[1] !== " " });
  }
  if (plan.size === 0) throw new Error("it has no '- [ ] N. **Title**' items");
  return plan;
}

function plural(n: usize, what: string): string {
  return `${n} ${what}${n === 1 ? "" : "s"}`;
}

function sized(files: usize, lines: usize): string {
  return `${plural(files, "file")} (${plural(lines, "line")})`;
}

// `planned` says the ranking was made with a plan, so a step it doesn't name is said to be missing.
export function formatRanking(r: Ref<Ranking>, planned: boolean = false): string {
  let files: usize = 0;
  let lines: usize = 0;
  for (const x of r.repos) {
    files += x.files;
    lines += x.lines;
  }
  let out = [`fishc survey --rank: ${plural(r.repos.length, "repo")}, ${sized(files, lines)} read`];
  for (const x of r.repos) out.push(`  ${x.dir}: ${sized(x.files, x.lines)}${x.unread.files > 0 ? `; ${sized(x.unread.files, x.unread.lines)} unread` : ""}`);
  out.push("");
  for (const l of formatCurve(r.curve, planned)) out.push(l);
  const self: Ref<{ dir: string; curve: Curve } | undefined> = r.self;
  if (self !== undefined) {
    out.push("");
    out.push(`self-hosting (${self.dir})`);
    for (const l of formatCurve(self.curve, planned)) out.push(l);
  }
  return out.join("\n");
}

// A step the plan lacks holds null, which Fish reads as an absent plan, so whether there was a
// plan at all is given apart.
function planText(s: Ref<Step>, planned: boolean): string {
  if (!planned) return "";
  const plan: Ref<{ item: string; done: boolean } | null | undefined> = s.plan;
  if (plan === null) return "  (not in the plan)";
  return `  (plan item ${plan!.item}${plan!.done ? ", done" : ""})`;
}

function formatCurve(c: Ref<Curve>, planned: boolean): string[] {
  let out = [`portable now: ${c.start.share}% of lines (${plural(c.start.files, "file")})`];
  for (let i: usize = 0; i < c.steps.length; i++) {
    const s: Ref<Step> = c.steps[i]!;
    out.push(`${`${i + 1}`.padStart(3)}. ${s.feature}${planText(s, planned)}\n       used by ${sized(s.files, s.lines)}; frees ${sized(s.gained.files, s.gained.lines)}; then ${s.portable.share}% portable`);
  }
  if (c.unread.length > 0) {
    out.push("also waiting, in files Fish couldn't read (what else they need is unknown):");
    for (const u of c.unread) out.push(`       ${u.feature}: ${sized(u.files, u.lines)}`);
  }
  return out;
}
