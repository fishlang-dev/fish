// error: this comptime code took more than 10,000,000 steps
// An empty endless loop is stopped by the step limit too.
function main() {
  comptime { for (;;) {} }
}
