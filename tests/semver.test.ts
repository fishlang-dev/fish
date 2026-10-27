import { expect, test } from "bun:test";
import { compare, formatVersion, maxSatisfying, parseRange, parseVersion, satisfies } from "../src/semver.ts";

const v = (text: string) => parseVersion(text)!;
// Whether `version` is in `range`, as npm's semver answers it.
const inRange = (version: string, range: string) => satisfies(v(version), parseRange(range)!);

test("versions parse and order as semver 2.0 has them", () => {
  expect(formatVersion(v("1.2.3-beta.1+build.5"))).toBe("1.2.3-beta.1");
  for (const bad of ["1.2", "01.2.3", "1.2.3-", "1.2.3-01", "a.b.c", ""]) expect(parseVersion(bad)).toBeUndefined();
  const order = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1", "1.1.0", "2.0.0"];
  expect([...order].reverse().map(v).sort(compare).map(formatVersion)).toEqual(order);
});

test("caret, tilde, x-ranges and hyphen ranges mean what npm says", () => {
  const cases: [string, string[], string[]][] = [
    ["^1.2.3", ["1.2.3", "1.9.9"], ["1.2.2", "2.0.0", "2.0.0-beta"]],
    ["^0.2.3", ["0.2.3", "0.2.9"], ["0.3.0", "0.2.2"]],
    ["^0.0.3", ["0.0.3"], ["0.0.4", "0.0.2"]],
    ["^1.2.x", ["1.2.0", "1.9.0"], ["2.0.0"]],
    ["^0.0.x", ["0.0.0", "0.0.9"], ["0.1.0"]],
    ["^0.0", ["0.0.5"], ["0.1.0"]],
    ["^1.x", ["1.0.0", "1.9.9"], ["2.0.0"]],
    ["~1.2.3", ["1.2.3", "1.2.9"], ["1.3.0"]],
    ["~1.2", ["1.2.0", "1.2.9"], ["1.3.0"]],
    ["~1", ["1.0.0", "1.9.9"], ["2.0.0"]],
    ["~0.2.3", ["0.2.3", "0.2.9"], ["0.3.0"]],
    ["1.x", ["1.0.0", "1.5.0"], ["2.0.0"]],
    ["1.2.*", ["1.2.0", "1.2.7"], ["1.3.0"]],
    ["*", ["0.0.1", "9.9.9"], ["1.0.0-beta"]],
    ["", ["3.0.0"], []],
    ["1.2.3 - 2.3.4", ["1.2.3", "2.3.4"], ["2.3.5", "1.2.2"]],
    ["1.2 - 2.3.4", ["1.2.0", "2.3.4"], ["1.1.9"]],
    ["1.2.3 - 2.3", ["2.3.9"], ["2.4.0"]],
    ["1.2.3 - 2", ["2.9.9"], ["3.0.0"]],
    [">=1.2.7 <1.3.0", ["1.2.7", "1.2.99"], ["1.2.6", "1.3.0"]],
    ["1.2.7 || >=1.2.9 <2.0.0", ["1.2.7", "1.2.9", "1.4.6"], ["1.2.8", "2.0.0"]],
    [">1", ["2.0.0"], ["1.9.9"]],
    ["<1.2", ["1.1.9"], ["1.2.0"]],
    ["<=1.2", ["1.2.9"], ["1.3.0"]],
    [">1.2", ["1.3.0"], ["1.2.9"]],
    ["= 1.2.3", ["1.2.3"], ["1.2.4"]],
    [">= 1.2.3", ["1.2.3"], ["1.2.2"]],
  ];
  for (const [range, yes, no] of cases) {
    for (const version of yes) expect([range, version, inRange(version, range)]).toEqual([range, version, true]);
    for (const version of no) expect([range, version, inRange(version, range)]).toEqual([range, version, false]);
  }
});

test("pre-releases match only a range naming one of the same version", () => {
  expect(inRange("1.2.3-alpha.7", ">1.2.3-alpha.3")).toBe(true);
  expect(inRange("3.4.5-alpha.9", ">1.2.3-alpha.3")).toBe(false);
  expect(inRange("1.2.3-beta.2", "^1.2.3-beta.2")).toBe(true);
  expect(inRange("1.2.4-beta.2", "^1.2.3-beta.2")).toBe(false);
  expect(inRange("1.3.0-rc.1", "^1.2.0")).toBe(false);
});

test("the highest satisfying version is chosen, and malformed ranges are refused", () => {
  const versions = ["1.0.0", "1.2.0", "1.9.3", "2.0.0", "2.1.0-beta"].map(v);
  expect(formatVersion(maxSatisfying(versions, parseRange("^1.0.0")!)!)).toBe("1.9.3");
  expect(formatVersion(maxSatisfying(versions, parseRange(">=1.0.0")!)!)).toBe("2.0.0");
  expect(maxSatisfying(versions, parseRange("^3")!)).toBeUndefined();
  for (const bad of ["^", "~x.1", "1.x.3", ">=a", "1.2.3 -", "1.2.3-", "latest"]) expect([bad, parseRange(bad)]).toEqual([bad, undefined]);
});

test("a range that names a -0 pre-release opts into that version's pre-releases, as npm's does", () => {
  expect(inRange("1.0.0-rc.1", ">=1.0.0-0")).toBe(true);
  expect(inRange("1.0.0-alpha", "^1.0.0-0")).toBe(true);
  expect(inRange("1.2.3-beta", ">=1.2.3-0 <2")).toBe(true);
  expect(inRange("1.5.0-beta", "^1.0.0-0")).toBe(false);
});
