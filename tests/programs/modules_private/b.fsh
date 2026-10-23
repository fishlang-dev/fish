function helper(n: i64): i64 { return n + 1; }
export function fromB(): string {
  // A local named like another file's private function.
  const fromA = helper(2);
  return `b ${fromA}`;
}
