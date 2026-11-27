// What the study's events say per task: how many people started it, how often they compiled, how
// many solved it or gave up, how long solving took, and the errors they met most.
import { TASKS } from "./tasks.fsh";

// One recorded event: `kind` is start, compile, solved or giveup; `codes` the error codes a
// compile gave, comma-separated; `ms` the time since the task was started.
export type EventRow = { session: string; task: string; kind: string; codes: string; ms: i64; at: i64 };
export type TaskSummary = { task: string; title: string; started: i64; compiles: i64; solved: i64; gaveUp: i64; medianMs: i64 | null; errors: [string, i64][] };

export const KINDS = ["start", "compile", "solved", "giveup"];

function median(xs: Mut<i64[]>): i64 | null {
  if (xs.length === 0) return null;
  xs.sort((a, b) => a - b);
  const mid = xs.length / 2;
  return xs.length % 2 === 1 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2;
}

// Each task's summary, in the tasks' order; a session counts once per task for started, solved
// and given up.
export function summarize(events: Ref<EventRow[]>): TaskSummary[] {
  let out: TaskSummary[] = [];
  for (const t of TASKS) {
    let started = new Set<string>();
    let solved = new Set<string>();
    let gaveUp = new Set<string>();
    let compiles: i64 = 0;
    let times: i64[] = [];
    let counts = new Map<string, i64>();
    for (const e of events) {
      if (e.task !== t.id) continue;
      if (e.kind === "start") started.add(e.session);
      else if (e.kind === "compile") {
        compiles++;
        if (e.codes !== "") for (const c of e.codes.split(",")) counts.set(c, (counts.get(c) ?? 0) + 1);
      } else if (e.kind === "solved" && !solved.has(e.session)) {
        solved.add(e.session);
        times.push(e.ms);
      } else if (e.kind === "giveup") gaveUp.add(e.session);
    }
    let errors: [string, i64][] = [...counts.entries()];
    errors.sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1));
    out.push({ task: t.id, title: t.title, started: started.size as i64, compiles, solved: solved.size as i64, gaveUp: gaveUp.size as i64, medianMs: median(times), errors: errors.slice(0, 5) });
  }
  return out;
}
