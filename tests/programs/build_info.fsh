// case: build_target
// What std:build says is the machine the test runs on, a dev build with no flags.
// expect: true
// expect: true
// expect: false
import { target, flags } from "std:build";
function main(): void {
  console.log(target.os === "macos" || target.os === "linux");
  console.log(target.arch === "aarch64" || target.arch === "x86_64");
  console.log(target.release || flags.has("anything"));
}

// case: build_release
// mode: release
// expect: release
import { target } from "std:build";
function main(): void {
  if (comptime target.release) console.log("release");
  else console.log("dev");
}

// case: build_flags
// flag: fast
// flag: level=3
// expect: fast
// expect: 3
// expect: none
// expect: no slow
import { flags } from "std:build";
function main(): void {
  if (comptime flags.has("fast")) console.log("fast");
  console.log(comptime flags.get("level") ?? "none");
  console.log(comptime flags.get("fast") ?? "none");
  if (comptime flags.has("slow")) console.log("slow"); else console.log("no slow");
}

// case: build_untaken_unchecked
// The branch for the other platform calls a function only that platform declares; it isn't checked.
// expect: one branch
import { target } from "std:build";
import * as build from "std:build";
function main(): void {
  if (comptime target.os === "macos" && target.os === "linux") {
    nothingDeclaresThis();
  } else if (!(comptime build.target.release)) {
    console.log("one branch");
  } else {
    alsoUndeclared(1, "x");
  }
}

// case: build_other_comptime_checked
// A comptime condition reading anything but std:build checks both branches.
// error: unknown function 'nothingDeclaresThis'
const ON = false;
function main(): void {
  if (comptime ON) nothingDeclaresThis();
  else console.log("off");
}

// case: build_bad_flag_name
// A std:build name the module doesn't have.
// error: 'std:build' has no export named 'platform'
import { platform } from "std:build";
function main(): void { console.log(platform); }
