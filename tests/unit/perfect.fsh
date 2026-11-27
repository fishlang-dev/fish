// The hash string switches and matches are dispatched on, as the runtime computes it.
import { dispatchOf, i32Text, perfectSeed, stringHash } from "../../src/perfect.fsh";
import { same } from "./support.fsh";

test("string dispatch: the hash is FNV-1a over UTF-16 units, the seed changing its start", () => {
  same(`${stringHash("", 0)}`, "2166136261", "the empty string's hash");
  same(`${stringHash("a", 0)}`, "3826002220", "a's hash");
  assert(stringHash("a", 1) !== stringHash("a", 0), "a seed changes the hash");
  assert(stringHash("😀", 0) === stringHash("😀", 0), "a character's hash is its two units'");
  same(i32Text(3826002220), "-468965076", "a hash as an i32 constant");
});

test("string dispatch: a dispatch takes each string's first test, and none below the threshold", () => {
  const tests: { text: string; at: usize }[] = [{ text: "a", at: 0 }, { text: "b", at: 1 }, { text: "a", at: 2 }, { text: "c", at: 3 }];
  const d = dispatchOf(tests, 3)!;
  same(d.keys.map((k) => `${k.at}`).join(","), "0,1,3", "the tests dispatched to");
  assert(dispatchOf(tests, 4) === undefined, "three distinct strings are below a threshold of four");
  assert(perfectSeed(["x", "y", "z"]) === 0, "the first seed tells three strings apart");
});

test("string dispatch: only the first units are hashed, so strings alike in them get no seed", () => {
  const long = "abcdefghijklmnop";
  assert(stringHash(long + "x", 0) === stringHash(long + "y", 0), "units past the sixteenth don't change the hash");
  assert(perfectSeed([long + "x", long + "y"]) === undefined, "no seed tells them apart");
});
