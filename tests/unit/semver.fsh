// Ports tests/semver.test.ts: versions and npm's ranges, in process through the compiler's semver
// module, which imports nothing else.
import { compare, formatVersion, maxSatisfying, parseRange, parseVersion, satisfies, type Range, type Version } from "../../src/semver.fsh";

function v(text: string): Version {
  const got = parseVersion(text);
  assert(got !== undefined, `'${text}' doesn't parse as a version`);
  return got!;
}

function range(text: string): Range {
  const got = parseRange(text);
  assert(got !== undefined, `'${text}' doesn't parse as a range`);
  return got!;
}

// Whether `version` is in `range`, as npm's semver answers it.
function inRange(version: string, text: string): boolean {
  return satisfies(v(version), range(text));
}

function holds(version: string, text: string, want: boolean, failures: Mut<string[]>): void {
  const got = inRange(version, text);
  if (got !== want) failures.push(`${version} in '${text}': expected ${want}, got ${got}`);
}

test("versions parse and order as semver 2.0 has them", () => {
  const shown = formatVersion(v("1.2.3-beta.1+build.5"));
  assert(shown === "1.2.3-beta.1", `formatted as ${shown}`);
  for (const bad of ["1.2", "01.2.3", "1.2.3-", "1.2.3-01", "a.b.c", ""]) assert(parseVersion(bad) === undefined, `'${bad}' parsed as a version`);
  const order = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1", "1.1.0", "2.0.0"];
  let reversed = order.clone();
  reversed.reverse();
  let versions = reversed.map((t) => v(t));
  versions.sort(compare);
  const sorted = versions.map((x) => formatVersion(x));
  assert(sorted === order, `sorted as ${sorted.join(", ")}`);
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
  let failures: string[] = [];
  for (const [text, yes, no] of cases) {
    for (const version of yes) holds(version, text, true, failures);
    for (const version of no) holds(version, text, false, failures);
  }
  assert(failures.length === 0, failures.join("\n"));
});

test("pre-releases match only a range naming one of the same version", () => {
  let failures: string[] = [];
  holds("1.2.3-alpha.7", ">1.2.3-alpha.3", true, failures);
  holds("3.4.5-alpha.9", ">1.2.3-alpha.3", false, failures);
  holds("1.2.3-beta.2", "^1.2.3-beta.2", true, failures);
  holds("1.2.4-beta.2", "^1.2.3-beta.2", false, failures);
  holds("1.3.0-rc.1", "^1.2.0", false, failures);
  assert(failures.length === 0, failures.join("\n"));
});

test("the highest satisfying version is chosen, and malformed ranges are refused", () => {
  const versions = ["1.0.0", "1.2.0", "1.9.3", "2.0.0", "2.1.0-beta"].map((t) => v(t));
  const one = maxSatisfying(versions, range("^1.0.0"));
  assert(one !== undefined && formatVersion(one!) === "1.9.3", "^1.0.0 didn't choose 1.9.3");
  const any = maxSatisfying(versions, range(">=1.0.0"));
  assert(any !== undefined && formatVersion(any!) === "2.0.0", ">=1.0.0 didn't choose 2.0.0");
  assert(maxSatisfying(versions, range("^3")) === undefined, "^3 chose a version");
  for (const bad of ["^", "~x.1", "1.x.3", ">=a", "1.2.3 -", "1.2.3-", "latest"]) assert(parseRange(bad) === undefined, `'${bad}' parsed as a range`);
});

test("a range that names a -0 pre-release opts into that version's pre-releases, as npm's does", () => {
  let failures: string[] = [];
  holds("1.0.0-rc.1", ">=1.0.0-0", true, failures);
  holds("1.0.0-alpha", "^1.0.0-0", true, failures);
  holds("1.2.3-beta", ">=1.2.3-0 <2", true, failures);
  holds("1.5.0-beta", "^1.0.0-0", false, failures);
  assert(failures.length === 0, failures.join("\n"));
});
