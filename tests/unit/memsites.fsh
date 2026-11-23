// The report a `--leaks` build prints at exit, read by scripts/sites.fsh: its rows, the sums per
// function, and what a row that can't be read does. In process, importing only the script.
import { byFunction, largest, sites, total, type Report } from "../../scripts/sites.fsh";

const REPORT = [
  "stage             resident          peak",
  "check            300.0 MiB     320.0 MiB",
  "fish: leaked 9 allocations (1700 bytes)",
  "  5 allocations, 500 bytes, at src/rebuild.fsh:4260:10 in cloneExpr",
  "  2 allocations, 1000 bytes, at src/rebuild.fsh:4300:3 in cloneExpr",
  "  1 allocation, 150 bytes, in Arenas.addClass",
  "  1 allocation, 50 bytes, at <runtime>",
  "",
].join("\n");

function read(text: string): Report {
  try {
    return sites(text);
  } catch (e) {
    assert(false, (e as { message: string }).message);
  }
  return { before: "", count: 0, bytes: 0, rows: [] };
}

function refused(text: string): string {
  try {
    sites(text);
  } catch (e) {
    return (e as { message: string }).message;
  }
  return "";
}

test("a report's rows are read with their sites, and what came before it is kept", () => {
  const r = read(REPORT);
  assert(r.count === 9 && r.bytes === 1700, "the header's totals");
  assert(r.before === "stage             resident          peak\ncheck            300.0 MiB     320.0 MiB", "what stderr held before the report");
  assert(r.rows.length === 4, "four rows");
  assert(r.rows[0]!.site === "src/rebuild.fsh:4260:10" && r.rows[0]!.name === "cloneExpr" && r.rows[0]!.count === 5 && r.rows[0]!.bytes === 500, "a row with a site");
  assert(r.rows[2]!.site === "" && r.rows[2]!.name === "Arenas.addClass", "a row naming only its function");
  assert(r.rows[3]!.site === "" && r.rows[3]!.name === "<runtime>", "a row made outside the program's frames");
  assert(total(r.rows) === r.bytes, "the rows add up to the header's bytes");
});

test("a function's sites are summed, and the largest comes first by bytes", () => {
  const r = read(REPORT);
  const functions = largest(byFunction(r.rows));
  assert(functions.length === 3, "three functions");
  assert(functions[0]!.name === "cloneExpr" && functions[0]!.bytes === 1500 && functions[0]!.count === 7, "cloneExpr's two sites as one");
  assert(functions[1]!.name === "Arenas.addClass" && functions[2]!.name === "<runtime>", "then by bytes");
  const rows = largest(read(REPORT).rows);
  assert(rows[0]!.bytes === 1000 && rows[1]!.bytes === 500, "sites by bytes, not by the count the runtime sorts on");
});

test("no report and a row that can't be read are errors, never a smaller sum", () => {
  assert(refused("stage resident peak\n").includes("no report"), "stderr with no report");
  assert(refused("fish: leaked 1 allocation (5 bytes)\n  1 allocation, 5 bytes, somewhere odd\n").includes("somewhere odd"), "a row with no place");
  assert(refused("fish: leaked 1 allocation (5 bytes)\nnot a row\n").includes("not a row"), "a line that is no row");
});
