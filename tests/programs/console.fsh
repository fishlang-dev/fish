// case: console_error_order
// expect: out
function main() {
  console.error("to stderr");
  console.warn({ w: 1 });
  console.log("out");
}
// case: clock_types
// expect: true true
function main() {
  const d: i64 = Date.now();
  const p: f64 = performance.now();
  console.log(d > 0, p >= 0.0);
}
// case: date_other_members
// error: 'Date.parse' isn't supported yet; 'Date.now()' is
function main() {
  console.log(Date.parse("x"));
}
// case: clock_arguments
// error: 'Date.now' takes no arguments
function main() {
  console.log(Date.now(1));
}
// case: clock_own_date
// expect: mine
class Date { static now(): string { return "mine"; } }
function main() {
  console.log(Date.now());
}
// case: console_own_object
// expect: mine y
// expect: mine z
class Logger {
  error(s: string): void { print("mine " + s); }
  log(s: string): void { print("mine " + s); }
}
function main() {
  const console = new Logger();
  console.error("y");
  console.log("z");
}
// case: clock_optional_call
// error: 'Date' is always there, so 'Date.now()' is called without '?.'
function main() {
  const t = Date?.now();
}
