// case: bigint_divide_by_zero
function main(): void {
  const zero = 0n;
  console.log(5n / zero);
}
// panic: Division by zero
// case: bigint_remainder_by_zero
function main(): void {
  const zero = 0n;
  console.log(5n % zero);
}
// panic: Division by zero
// case: bigint_negative_exponent
function main(): void {
  const e = -1n;
  console.log(2n ** e);
}
// panic: Exponent must be non-negative
// case: bigint_too_big
function main(): void {
  const e = 4294967296n * 4294967296n;
  console.log(2n ** e);
}
// panic: Maximum BigInt size exceeded
// case: bigint_mixed
function main(): void {
  const n = 1n + 1;
}
// error: operator '+' can't mix 'bigint' and 'i64'; convert the number with 'BigInt(x)', or the bigint with 'as i64'
// case: bigint_unsigned_shift
function main(): void {
  const n = 8n >>> 1n;
}
// error: operator '>>>' cannot be applied to type 'bigint'; a bigint has no unsigned right shift, so use '>>'
// case: bigint_values
type Account = { id: string; balance: bigint };
function total(accounts: Ref<Account[]>): bigint {
  let sum = 0n;
  for (const a of accounts) sum += a.balance;
  return sum;
}
function main(): void {
  const accounts: Account[] = [{ id: "a", balance: 10000000000000000000000n }, { id: "b", balance: -1n }];
  const maybe: bigint | null = accounts.length > 1 ? total(accounts) : null;
  console.log(maybe, accounts[0], maybe === 9999999999999999999999n);
}
// expect: 9999999999999999999999n { balance: 10000000000000000000000n, id: 'a' } true
