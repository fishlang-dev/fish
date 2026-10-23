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
export type Curve = { start: Share; steps: Step[] };
// A file that can't be read is left out of the curve: what else it waits on is unknown.
export type Repo = { dir: string; files: number; lines: number; unread: { files: number; lines: number } };
export type Ranking = { repos: Repo[]; curve: Curve; self?: { dir: string; curve: Curve } };

type Unit = { lines: number; waits: Set<string>; rules: [string, string][] };
type Plan = Map<string, { item: string; done: boolean }>;

export function rank(dirs: string[], self?: string, plan?: Plan): Ranking {
  const scanned = dirs.map((dir) => ({ dir, scans: scanFiles(dir) }));
  const count = (scans: FileScan[]) => ({ files: scans.length, lines: scans.reduce((n, f) => n + f.lines, 0) });
  const repos = scanned.map(({ dir, scans }) => ({ dir, ...count(scans.filter((f) => f.read)), unread: count(scans.filter((f) => !f.read)) }));
  const read = (scans: FileScan[]) => scans.filter((f) => f.read).map(unit);
  const curve = curveOf(scanned.flatMap(({ scans }) => read(scans)), plan);
  return { repos, curve, ...(self !== undefined && { self: { dir: self, curve: curveOf(read(scanFiles(self)), plan) } }) };
}

function unit(f: FileScan): Unit {
  return { lines: f.lines, waits: new Set(featuresOf(f)), rules: f.findings.map(([id]) => [id, featureOf(id) ?? ""]) };
}

function curveOf(units: Unit[], plan?: Plan): Curve {
  const total = { files: units.length, lines: units.reduce((n, u) => n + u.lines, 0) };
  const share = (files: number, lines: number): Share => ({ files, lines, share: total.lines === 0 ? 100 : Math.round((lines * 1000) / total.lines) / 10 });
  const picked = new Set<string>();
  let open = units.filter((u) => u.waits.size > 0);
  let portable = { files: units.length - open.length, lines: total.lines - open.reduce((n, u) => n + u.lines, 0) };
  const start = share(portable.files, portable.lines);
  const steps: Step[] = [];
  while (open.length > 0) {
    const remaining = [...new Set(open.flatMap((u) => [...u.waits].filter((w) => !picked.has(w))))];
    const freed = (w: string) => open.filter((u) => [...u.waits].every((x) => x === w || picked.has(x)));
    // Ties, and steps that free nothing yet, go to the feature carrying most of what still waits,
    // each file's lines shared among the features it still needs.
    const weight = (w: string) => open.filter((u) => u.waits.has(w)).reduce((n, u) => n + u.lines / [...u.waits].filter((x) => !picked.has(x)).length, 0);
    const score = (w: string): [number, number] => [freed(w).reduce((n, u) => n + u.lines, 0), weight(w)];
    const best = remaining.sort((a, b) => {
      const [x, y] = [score(a), score(b)];
      return y[0] - x[0] || y[1] - x[1] || (a < b ? -1 : 1);
    })[0]!;
    const users = open.filter((u) => u.waits.has(best));
    const gained = freed(best);
    picked.add(best);
    open = open.filter((u) => !gained.includes(u));
    portable = { files: portable.files + gained.length, lines: portable.lines + gained.reduce((n, u) => n + u.lines, 0) };
    steps.push({
      feature: best,
      rules: [...new Set(units.flatMap((u) => u.rules.filter(([, f]) => f === best).map(([id]) => id)))].sort(),
      ...(plan && { plan: plan.get(best.toLowerCase()) ?? null }),
      files: users.length, lines: users.reduce((n, u) => n + u.lines, 0),
      gained: { files: gained.length, lines: gained.reduce((n, u) => n + u.lines, 0) },
      portable: share(portable.files, portable.lines),
    });
  }
  return { start, steps };
}

// The plan's items by title, ignoring case: each `- [ ] N. **Title**` line, ticked or not.
export function readPlan(path: string): Plan {
  const plan: Plan = new Map();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*- \[([ xX])\] (\w+)\. \*\*(.+?)\*\*/.exec(line);
    if (m) plan.set(m[3]!.toLowerCase(), { item: m[2]!, done: m[1] !== " " });
  }
  return plan;
}

const plural = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;
const sized = (files: number, lines: number) => `${plural(files, "file")} (${plural(lines, "line")})`;

export function formatRanking(r: Ranking): string {
  const total = r.repos.reduce((n, x) => ({ files: n.files + x.files, lines: n.lines + x.lines }), { files: 0, lines: 0 });
  const unread = (x: Repo) => (x.unread.files > 0 ? `; ${sized(x.unread.files, x.unread.lines)} unread, left out` : "");
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
  ];
}
