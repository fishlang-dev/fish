// expect: mine /a
// A program declaring its own Request doesn't get the std HTTP library, so nothing clashes.
class Request { path: string; constructor(path: string) { this.path = path; } }
function main() {
  const r = new Request("/a");
  console.log("mine", r.path);
}
