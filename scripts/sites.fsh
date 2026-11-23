// Reads the report a `--leaks` build's runtime prints at exit: what was still live, one row per
// allocation site, which the runtime sorts by count.

// One site's live blocks. `site` is "" where the runtime names only the function, and `name` is
// "<runtime>" for blocks made outside the program's own frames.
export type Row = { bytes: usize; count: usize; site: string; name: string };

// A report: what the process wrote to stderr before it, then its own totals and its rows.
export type Report = { before: string; count: usize; bytes: usize; rows: Row[] };

function int(digits: string): usize {
  return Number(digits)! as usize;
}

// Where a row's blocks were made, from what follows its counts.
function placed(where: string, count: usize, bytes: usize): Row throws Error {
  if (where === "at <runtime>") return { bytes, count, site: "", name: "<runtime>" };
  if (where.startsWith("in ")) return { bytes, count, site: "", name: where.slice(3) };
  const split = where.indexOf(" in ");
  if (!where.startsWith("at ") || split < 0) throw new Error(`can't read where a row's blocks were made: '${where}'`);
  return { bytes, count, site: where.slice(3, split), name: where.slice(split + 4) };
}

// The report in `text`, a process's whole stderr. An error when there is none or a row can't be
// read, since a row skipped would make every sum too small without saying so.
export function sites(text: string): Report throws Error {
  let before: string[] = [];
  let rows: Row[] = [];
  let count: usize = 0;
  let bytes: usize = 0;
  let found = false;
  for (const line of text.split("\n")) {
    if (!found) {
      const head = /^fish: leaked (\d+) allocations? \((\d+) bytes?\)$/.exec(line);
      if (head === null) before.push(line);
      else {
        found = true;
        count = int(head[1]!);
        bytes = int(head[2]!);
      }
      continue;
    }
    if (line === "") continue;
    const row = /^  (\d+) allocations?, (\d+) bytes?, (.+)$/.exec(line);
    if (row === null) throw new Error(`can't read the report's row '${line}'`);
    rows.push(placed(row[3]!, int(row[1]!), int(row[2]!)));
  }
  if (!found) throw new Error("no report of live allocations: a '--leaks' build prints one at exit");
  return { before: before.join("\n"), count, bytes, rows };
}

// The rows summed per function, a function's sites as one.
export function byFunction(rows: Ref<Row[]>): Row[] {
  let at = new Map<string, usize>();
  let out: Row[] = [];
  for (let i: usize = 0; i < rows.length; i++) {
    const r: Ref<Row> = rows[i]!;
    const known = at.get(r.name);
    if (known === undefined) {
      at.set(r.name, out.length);
      out.push({ bytes: r.bytes, count: r.count, site: "", name: r.name });
    } else {
      out[known!]!.bytes += r.bytes;
      out[known!]!.count += r.count;
    }
  }
  return out;
}

// Largest first by bytes, then by count, then by where, so two runs of one program print alike.
export function largest(rows: Row[]): Row[] {
  let sorted = rows;
  sorted.sort((a, b) => {
    if (a.bytes !== b.bytes) return a.bytes > b.bytes ? -1 : 1;
    if (a.count !== b.count) return a.count > b.count ? -1 : 1;
    const x = `${a.name} ${a.site}`;
    const y = `${b.name} ${b.site}`;
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return sorted;
}

// What the rows hold in all, which a whole report's rows must equal its own total.
export function total(rows: Ref<Row[]>): usize {
  let sum: usize = 0;
  for (let i: usize = 0; i < rows.length; i++) sum += rows[i]!.bytes;
  return sum;
}
