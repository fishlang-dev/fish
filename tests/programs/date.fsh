// case: date_epoch
// expect: 1970-01-01T00:00:00.000Z Thu, 01 Jan 1970 00:00:00 GMT
// expect: 1970-01-01T00:00:00.001Z Thu, 01 Jan 1970 00:00:00 GMT
// expect: 1969-12-31T23:59:59.999Z Wed, 31 Dec 1969 23:59:59 GMT
// expect: 1969-12-31T00:00:00.000Z Wed, 31 Dec 1969 00:00:00 GMT
// The epoch and the moments either side of it, as Bun writes them.
function show(ms: i64) {
  const d = new Date(ms);
  console.log(d.toISOString(), d.toUTCString());
}
function main() {
  for (const ms of [0, 1, -1, -86400000]) show(ms);
}
// case: date_leap_years
// expect: 2000-02-29T00:00:00.000Z Tue, 29 Feb 2000 00:00:00 GMT
// expect: 2000-02-29T23:59:59.999Z Tue, 29 Feb 2000 23:59:59 GMT
// expect: 2000-03-01T00:00:00.000Z Wed, 01 Mar 2000 00:00:00 GMT
// expect: 2024-02-29T00:00:00.000Z Thu, 29 Feb 2024 00:00:00 GMT
// expect: 2100-02-28T00:00:00.000Z Sun, 28 Feb 2100 00:00:00 GMT
// expect: 2100-03-01T00:00:00.000Z Mon, 01 Mar 2100 00:00:00 GMT
// 2000 is a leap year as a multiple of 400, and 2100 isn't as a multiple of 100 alone.
function show(ms: i64) {
  const d = new Date(ms);
  console.log(d.toISOString(), d.toUTCString());
}
function main() {
  for (const ms of [951782400000, 951868799999, 951868800000, 1709164800000, 4107456000000, 4107542400000]) show(ms);
}
// case: date_year_boundaries
// expect: 2025-12-31T23:59:59.999Z Wed, 31 Dec 2025 23:59:59 GMT
// expect: 2026-01-01T00:00:00.000Z Thu, 01 Jan 2026 00:00:00 GMT
// expect: 1999-12-31T23:59:59.999Z Fri, 31 Dec 1999 23:59:59 GMT
// expect: 2000-01-01T00:00:00.000Z Sat, 01 Jan 2000 00:00:00 GMT
function show(ms: i64) {
  const d = new Date(ms);
  console.log(d.toISOString(), d.toUTCString());
}
function main() {
  for (const ms of [1767225599999, 1767225600000, 946684799999, 946684800000]) show(ms);
}
// case: date_extended_years
// expect: 9999-12-31T23:59:59.999Z Fri, 31 Dec 9999 23:59:59 GMT
// expect: +010000-01-01T00:00:00.000Z Sat, 01 Jan 10000 00:00:00 GMT
// expect: +275760-09-13T00:00:00.000Z Sat, 13 Sep 275760 00:00:00 GMT
// expect: 0000-01-01T00:00:00.000Z Sat, 01 Jan 0000 00:00:00 GMT
// expect: -000001-12-31T23:59:59.999Z Fri, 31 Dec -0001 23:59:59 GMT
// expect: -000001-01-01T00:00:00.000Z Fri, 01 Jan -0001 00:00:00 GMT
// expect: -271821-04-20T00:00:00.000Z Tue, 20 Apr -271821 00:00:00 GMT
// Years past four digits take a sign and six in ISO form, up to the first and last times a Date
// holds.
function show(ms: i64) {
  const d = new Date(ms);
  console.log(d.toISOString(), d.toUTCString());
}
function main() {
  for (const ms of [253402300799999, 253402300800000, 8640000000000000, -62167219200000, -62167219200001, -62198755200000, -8640000000000000]) show(ms);
}
// case: date_utc_getters
// expect: 1970 0 1 4 0 0 0 0
// expect: 1969 11 31 3 23 59 59 999
// expect: 2026 10 1 0 12 29 41 42
// expect: -2 11 31 4 23 59 59 999
// Months count from 0 and weekdays from Sunday, as in JavaScript.
function show(ms: i64) {
  const d = new Date(ms);
  console.log(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCDay(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}
function main() {
  for (const ms of [0, -1, 1793536181042, -62198755200001]) show(ms);
}
// case: date_now_and_values
// expect: true true
// expect: 1793536181042 1793536181042 2026-11-01T12:29:41.042Z
// expect: true false true
// expect: true
// new Date() is Date.now()'s time, and Dates compare by their times.
function main() {
  const before = Date.now();
  const now = new Date();
  const after = Date.now();
  console.log(now.getTime() >= before && now.getTime() <= after, now.valueOf() === now.getTime());
  const d = new Date(1793536181042);
  console.log(d.getTime(), d.valueOf(), d.toJSON());
  console.log(new Date(3) === new Date(3), new Date(3) === new Date(4), new Date(3) !== new Date(4));
  const copy = d.clone();
  console.log(copy === d);
}
// case: date_too_late
// panic: a Date holds a time within 8640000000000000 milliseconds of 1970-01-01, so 8640000000000001 can't be one
// JavaScript's Invalid Date, whose toISOString throws a RangeError, is a panic where it is made.
function main() {
  const d = new Date(8640000000000001);
  console.log(d.getTime());
}
// case: date_too_early
// panic: so -8640000000000001 can't be one
function main() {
  const d = new Date(-8640000000000001);
  console.log(d.getTime());
}
// case: date_own_class
// expect: mine a=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax
// A program's own Date keeps its name, and std's cookies still write theirs.
class Date { static now(): string { return "mine"; } }
function main() {
  let jar = new CookieMap();
  jar.set("a", "", { expires: 0 });
  console.log(Date.now(), jar.toSetCookieHeaders()[0]);
}
