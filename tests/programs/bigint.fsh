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
// case: bigint_conversions
function fact(n: bigint): bigint {
  return n <= 1n ? 1n : n * fact(n - 1n);
}
const F = comptime fact(30n);
function main(): void {
  const big = -340282366920938463463374607431768211457n * 3n;
  const n: i32 = -5;
  const u: u64 = 18446744073709551615;
  console.log(BigInt(n), BigInt(u), BigInt(BigInt(7)), big as i64, big as u8, big as i128, big as u128, big as f64, 12345n as f32);
  console.log(big.toString(), big.toString(16), (255n).toString(2), (35n).toString(36), String(big));
  const x: bigint | string = 5n;
  if (typeof x === "bigint") console.log("bigint", x + 1n);
  console.log(F, F === fact(30n));
}
// expect: -5n 18446744073709551615n 7n -3 253 -3 340282366920938463463374607431768211453 -1.0208471007628154e+39 12345
// expect: -1020847100762815390390123822295304634371 -300000000000000000000000000000003 11111111 z -1020847100762815390390123822295304634371
// expect: bigint 6n
// expect: 265252859812191058636308480000000n true
// case: bigint_radix
function main(): void {
  const r = 37;
  console.log((5n).toString(r));
}
// panic: toString() radix must be between 2 and 36
// case: bigint_json
function main(): void {
  console.log(JSON.stringify({ n: 1n }));
}
// error: values of type 'bigint' can't be written as JSON
// case: bigint_from_float
function main(): void {
  const b = BigInt(1.5);
}
// error: 'BigInt' takes an integer, not 'number'; convert the float with 'as i64' first
// case: bigint_as
function main(): void {
  const n = 5;
  const b = n as bigint;
}
// error: 'i64' converts to a bigint with 'BigInt(x)', not 'as'
// case: bigint_switch
function main(): void {
  const b = 10n ** 30n / 10n ** 29n;
  switch (b) {
    case 10n:
      console.log("ten");
      break;
    default:
      console.log("other");
  }
}
// expect: ten
// case: bigint_constant_beside_string
function main(): void {
  const s: string = "bigint 5";
  const a = 5n;
  console.log(a + 1n, s, s.length);
}
// expect: 6n bigint 5 8
// case: bigint_format
function main(): void {
  const wide: i128 = 9223372036854775807 * 4;
  console.log("%d %i %s", wide, wide, wide);
  console.log("%d %i %f %s", 100000000000000000000n, 5n, 5n, 5n);
}
// expect: 36893488147419103228 36893488147419103228 36893488147419103228
// expect: 100000000000000000000n 5n 5 5n
// case: bigint_comptime_typeof
function g(x: bigint | string): string {
  if (typeof x === "bigint") return "big";
  return "str";
}
const AT = comptime g(5n);
function main(): void {
  console.log(AT, g(5n));
}
// expect: big big
// case: bigint_shift_too_big
function main(): void {
  const n = 4000000000n;
  console.log(1n << n);
}
// panic: Maximum BigInt size exceeded
// case: bigint_power_too_big
function main(): void {
  const n = 2000000000n;
  console.log(2n ** n);
}
// panic: Maximum BigInt size exceeded
