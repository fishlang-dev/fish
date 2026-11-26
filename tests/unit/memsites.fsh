// The report a `--leaks` build prints at exit, read by scripts/sites.fsh: its rows, the sums per
// function, and what a row that can't be read does. In process, importing only the script.
import { byFunction, changes, largest, readSnapshot, sites, snapshot, snapshotJson, total, type Report, type Snapshot } from "../../scripts/sites.fsh";

// A function, not a top-level const: comptime would have to run `join` to bake one.
function report(): string {
  return [
    "stage             resident          peak",
    "check            300.0 MiB     320.0 MiB",
    "fish: leaked 9 allocations (1700 bytes)",
    "  5 allocations, 500 bytes, at src/rebuild.fsh:4260:10 in cloneExpr",
    "  2 allocations, 1000 bytes, at src/rebuild.fsh:4300:3 in cloneExpr",
    "  1 allocation, 150 bytes, in Arenas.addClass",
    "  1 allocation, 50 bytes, at <runtime>",
    "",
  ].join("\n");
}

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
  const r = read(report());
  assert(r.count === 9 && r.bytes === 1700, "the header's totals");
  assert(r.before === "stage             resident          peak\ncheck            300.0 MiB     320.0 MiB", "what stderr held before the report");
  assert(r.rows.length === 4, "four rows");
  assert(r.rows[0]!.site === "src/rebuild.fsh:4260:10" && r.rows[0]!.name === "cloneExpr" && r.rows[0]!.count === 5 && r.rows[0]!.bytes === 500, "a row with a site");
  assert(r.rows[2]!.site === "" && r.rows[2]!.name === "Arenas.addClass", "a row naming only its function");
  assert(r.rows[3]!.site === "" && r.rows[3]!.name === "<runtime>", "a row made outside the program's frames");
  assert(total(r.rows) === r.bytes, "the rows add up to the header's bytes");
});

test("a function's sites are summed, and the largest comes first by bytes", () => {
  const r = read(report());
  const functions = largest(byFunction(r.rows));
  assert(functions.length === 3, "three functions");
  assert(functions[0]!.name === "cloneExpr" && functions[0]!.bytes === 1500 && functions[0]!.count === 7, "cloneExpr's two sites as one");
  assert(functions[1]!.name === "Arenas.addClass" && functions[2]!.name === "<runtime>", "then by bytes");
  const rows = largest(read(report()).rows);
  assert(rows[0]!.bytes === 1000 && rows[1]!.bytes === 500, "sites by bytes, not by the count the runtime sorts on");
});

test("no report and a row that can't be read are errors, never a smaller sum", () => {
  assert(refused("stage resident peak\n").includes("no report"), "stderr with no report");
  assert(refused("fish: leaked 1 allocation (5 bytes)\n  1 allocation, 5 bytes, somewhere odd\n").includes("somewhere odd"), "a row with no place");
  assert(refused("fish: leaked 1 allocation (5 bytes)\nnot a row\n").includes("not a row"), "a line that is no row");
});

function reread(text: string): Snapshot {
  try {
    return readSnapshot(text);
  } catch (e) {
    assert(false, (e as { message: string }).message);
  }
  return { stage: "", count: 0, bytes: 0, functions: [], sites: [] };
}

function unread(text: string): string {
  try {
    readSnapshot(text);
  } catch (e) {
    return (e as { message: string }).message;
  }
  return "";
}

test("a snapshot written as JSON reads back with every row, largest first", () => {
  const s = reread(snapshotJson(snapshot("check", read(report()))));
  assert(s.stage === "check" && s.count === 9 && s.bytes === 1700, "the stage and totals");
  assert(s.functions.length === 3 && s.functions[0]!.name === "cloneExpr" && s.functions[0]!.bytes === 1500, "functions summed, largest first");
  assert(s.sites.length === 4 && s.sites[0]!.bytes === 1000 && s.sites[0]!.site === "src/rebuild.fsh:4300:3", "sites, largest first");
  assert(unread(snapshotJson(snapshot("check", read(report()))).replace("\"bytes\": 1700", "\"bytes\": 1600")).includes("1600"), "rows that don't add up to the total");
});

test("changes count a row in one snapshot only as 0 in the other, and sort by the size of the change", () => {
  const before = read(report()).rows;
  const after = read(report().replace("2 allocations, 1000 bytes", "3 allocations, 1200 bytes").replace("  1 allocation, 150 bytes, in Arenas.addClass\n", "").replace("at <runtime>", "at <runtime>\n  4 allocations, 400 bytes, in Typing.shapeKey")).rows;
  const c = changes(before, after);
  assert(c.length === 3, "the unchanged rows left out");
  assert(c[0]!.name === "Typing.shapeKey" && c[0]!.before === 0 && c[0]!.after === 400 && c[0]!.bytes === 400 && c[0]!.count === 4, "a row only after");
  assert(c[1]!.site === "src/rebuild.fsh:4300:3" && c[1]!.bytes === 200 && c[1]!.count === 1, "a row that grew");
  assert(c[2]!.name === "Arenas.addClass" && c[2]!.after === 0 && c[2]!.bytes === -150 && c[2]!.count === -1, "a row only before, a shrink sorted by its size");
});
