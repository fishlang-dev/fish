import { expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BASELINE, survey, type Baseline } from "../scripts/selfhost.ts";

setDefaultTimeout(300_000);

// The compiler's own source may only get closer to checking with Fish: a file that checked keeps
// checking, and the failing count never rises.
test("no compiler source file that checked with Fish stops checking", () => {
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Baseline;
  const now = survey();
  const regressed = Object.keys(now).filter((f) => now[f] !== null && !(f in baseline.failing));
  expect(regressed).toEqual([]);
  const count = Object.values(now).filter((e) => e !== null).length;
  expect(count).toBeLessThanOrEqual(baseline.count);
  if (count < baseline.count) console.log(`self-hosting: ${baseline.count - count} more file(s) check; run 'bun scripts/selfhost.ts --update' to lower the baseline`);
});
