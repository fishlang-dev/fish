import { readFileSync } from "node:fs";
import { featureOf, featuresOf, scanFiles, type FileScan } from "./survey.ts";

// `fishc survey --rank`: which Fish features to build first. A file is portable once every
// feature it waits on exists; the curve picks, one at a time, the feature that makes the most
// lines portable, so its order is the order to build in and its shares say how fast that goes.

export type Share = { files: number; lines: number; share: number };
export type Step = {
  feature: string; rules: string[]; plan?: { item: string; done: boolean } | null;
  files: number; lines: number; gained: { files: number; lines: number }; portable: Share;
};
// A file that can't be read stays out of the steps, since what else it waits on is unknown, but
// its lines stay in every share, and `unread` lists them by what they are known to wait on.
export type Curve = { start: Share; steps: Step[]; unread: { feature: string; files: number; lines: number }[] };
export type Repo = { dir: string; files: number; lines: number; unread: { files: number; lines: number } };
export type Ranking = { repos: Repo[]; curve: Curve; self?: { dir: string; curve: Curve } };

export type Unit = { lines: number; waits: Set<string>; rules: [string, string][] };
type Plan = Map<string, { item: string; done: boolean }>;

export function rank(dirs: string[], self?: string, plan?: Plan): Ranking {
  const scanned = dirs.map((dir) => ({ dir, scans: scanFiles(dir) }));
  const count = (scans: FileScan[]) => ({ files: scans.length, lines: scans.reduce((n, f) => n + f.lines, 0) });
  const repos = scanned.map(({ dir, scans }) => ({ dir, ...count(scans.filter((f) => f.read)), unread: count(scans.filter((f) => !f.read)) }));
  const curve = curveOf(scanned.flatMap(({ scans }) => scans), plan);
  return { repos, curve, ...(self !== undefined && { self: { dir: self, curve: curveOf(scanFiles(self), plan) } }) };
}

function unit(f: FileScan): Unit {
  return { lines: f.lines, waits: new Set(featuresOf(f)), rules: f.findings.map(([id]) => [id, featureOf(id) ?? ""]) };
}

function curveOf(scans: FileScan[], plan?: Plan): Curve {
  const { start, steps } = stepsOf(scans.filter((f) => f.read).map(unit), scans.reduce((n, f) => n + f.lines, 0), plan);
  const unread = new Map<string, { files: number; lines: number }>();
  for (const f of scans.filter((s) => !s.read)) {
    const feature = featuresOf(f)[0] ?? "files that couldn't be opened";
    const entry = unread.get(feature) ?? { files: 0, lines: 0 };
    unread.set(feature, { files: entry.files + 1, lines: entry.lines + f.lines });
  }
  return { start, steps, unread: [...unread].map(([feature, n]) => ({ feature, ...n })).sort((a, b) => b.lines - a.lines) };
}

// The steps over files already read, each a unit of lines waiting on features; `total` counts
// every line surveyed, unread ones too.
export function stepsOf(units: Unit[], total: number, plan?: Plan): { start: Share; steps: Step[] } {
  // Rounded down, so 100% means every line, unread ones included.
  const share = (files: number, lines: number): Share => ({ files, lines, share: total === 0 ? 0 : Math.floor((lines * 1000) / total) / 10 });
  const sum = (us: Unit[]) => us.reduce((n, u) => n + u.lines, 0);
  const picked = new Set<string>();
  let open = units.filter((u) => u.waits.size > 0);
  let portable = { files: units.length - open.length, lines: sum(units) - sum(open) };
  const start = share(portable.files, portable.lines);
  const steps: Step[] = [];
  while (open.length > 0) {
    const needs = (u: Unit) => [...u.waits].filter((w) => !picked.has(w));
    const remaining = [...new Set(open.flatMap(needs))];
    const freed = (w: string) => open.filter((u) => needs(u).every((x) => x === w));
    // Ties, and steps that free nothing yet, go to the feature carrying most of what still
    // waits, each file's lines shared among the features it still needs; rounded so float
    // noise can't beat the name.
    const weight = (w: string) => Math.round(open.filter((u) => u.waits.has(w)).reduce((n, u) => n + u.lines / needs(u).length, 0) * 1e6);
    const scored = remaining.map((w) => ({ w, gain: sum(freed(w)), weight: weight(w) }));
    scored.sort((a, b) => b.gain - a.gain || b.weight - a.weight || (a.w < b.w ? -1 : 1));
    const best = scored[0]!.w;
    const users = open.filter((u) => u.waits.has(best));
    const gained = new Set(freed(best));
    picked.add(best);
    open = open.filter((u) => !gained.has(u));
    portable = { files: portable.files + gained.size, lines: portable.lines + sum([...gained]) };
    steps.push({
      feature: best,
      rules: [...new Set(units.flatMap((u) => u.rules.filter(([, f]) => f === best).map(([id]) => id)))].sort(),
      ...(plan && { plan: plan.get(best.toLowerCase()) ?? null }),
      files: users.length, lines: sum(users),
      gained: { files: gained.size, lines: sum([...gained]) },
      portable: share(portable.files, portable.lines),
    });
  }
  return { start, steps };
}

// The plan's items by title, ignoring case and backticks: each `- [ ] N. **Title**` line, ticked
// or not, the first of any titles written twice.
export function readPlan(path: string): Plan {
  const plan: Plan = new Map();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*- \[([ xX])\]\s+(\w+)\.\s+\*\*(.+?)\*\*/.exec(line);
    const title = m?.[3]!.replaceAll("`", "").toLowerCase();
    if (m && title !== undefined && !plan.has(title)) plan.set(title, { item: m[2]!, done: m[1] !== " " });
  }
  if (plan.size === 0) throw new Error("it has no '- [ ] N. **Title**' items");
  return plan;
}

const plural = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;
const sized = (files: number, lines: number) => `${plural(files, "file")} (${plural(lines, "line")})`;

export function formatRanking(r: Ranking): string {
  const total = r.repos.reduce((n, x) => ({ files: n.files + x.files, lines: n.lines + x.lines }), { files: 0, lines: 0 });
  const unread = (x: Repo) => (x.unread.files > 0 ? `; ${sized(x.unread.files, x.unread.lines)} unread` : "");
  return [
    `fishc survey --rank: ${plural(r.repos.length, "repo")}, ${sized(total.files, total.lines)} read`,
    ...r.repos.map((x) => `  ${x.dir}: ${sized(x.files, x.lines)}${unread(x)}`),
    "",
    ...formatCurve(r.curve),
    ...(r.self ? ["", `self-hosting (${r.self.dir})`, ...formatCurve(r.self.curve)] : []),
  ].join("\n");
}

function formatCurve(c: Curve): string[] {
  const plan = (s: Step) => (s.plan === undefined ? "" : s.plan === null ? "  (not in the plan)" : `  (plan item ${s.plan.item}${s.plan.done ? ", done" : ""})`);
  return [
    `portable now: ${c.start.share}% of lines (${plural(c.start.files, "file")})`,
    ...c.steps.map((s, i) => `${String(i + 1).padStart(3)}. ${s.feature}${plan(s)}\n       used by ${sized(s.files, s.lines)}; frees ${sized(s.gained.files, s.gained.lines)}; then ${s.portable.share}% portable`),
    ...(c.unread.length ? ["also waiting, in files Fish couldn't read (what else they need is unknown):", ...c.unread.map((u) => `       ${u.feature}: ${sized(u.files, u.lines)}`)] : []),
  ];
}
