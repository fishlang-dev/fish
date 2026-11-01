// How long each stage of a build took, kept only when `--timings` asks. Each stage records its own
// time: a stage timed inside another is taken out of the outer one, so borrow checking inside the
// checker, or the comptime interpreter inside macro expansion, is counted once, under its own name.
// `inner` is the time the stages running inside the current one have taken so far. `objects` names
// the cached objects built, and counts those reused.
export type Timings = { ms: Map<string, number>; notes: Map<string, string>; inner: number; objects: { built: string[]; cached: number } };

export const FRONT_END = ["parse", "macros", "check", "moves", "comptime"];
export const NATIVE_STAGES = ["compile", "runtime", "link"];

export function newTimings(): Timings {
  return { ms: new Map(), notes: new Map(), inner: 0, objects: { built: [], cached: 0 } };
}

// Runs `run`, adding its own time to stage `name` when timing.
export function timed<T>(timings: Timings | undefined, name: string, run: () => T): T {
  if (!timings) return run();
  const outer = timings.inner;
  timings.inner = 0;
  const start = performance.now();
  try {
    return run();
  } finally {
    const spent = performance.now() - start;
    timings.ms.set(name, (timings.ms.get(name) ?? 0) + spent - timings.inner);
    timings.inner = outer + spent;
  }
}

// One line per stage of `stages`, in that order, a stage that never ran as 0.0, then the total.
export function formatTimings(timings: Timings, stages: string[], total: number): string {
  const line = (name: string, ms: number, note?: string) => `${name.padEnd(9)}${ms.toFixed(1).padStart(9)} ms${note ? ` (${note})` : ""}\n`;
  return stages.map((s) => line(s, timings.ms.get(s) ?? 0, timings.notes.get(s))).join("") + line("total", total);
}

// Which cached objects a build made and how many it reused, as the runtime stage's note.
export function objectsNote({ objects: { built, cached } }: Timings): string {
  return [...(built.length > 0 ? [`built ${built.join(", ")}`] : []), `${cached} cached`].join("; ");
}
