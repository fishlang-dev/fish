export function sum(n: i64): i64 {
  let total = 0;
  for (let i = 1; i <= n; i++) total += i;
  return total;
}
