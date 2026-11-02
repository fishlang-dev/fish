// Reading standard input: readLine, and the stdin module's lines, text and bytes, from one buffer.

// case: stdin_lines
// stdin: "one\ntwo\nthree\n"
// expect: [one]
// expect: [two]
// expect: [three]
// expect: done
async function main() {
  for await (const line of stdin.lines()) console.log(`[${line}]`);
  console.log("done");
}

// case: stdin_empty
// stdin: ""
// expect: none
// expect: lines: 0
// expect: text: []
// expect: bytes: 0
async function main() {
  const line = await readLine();
  console.log(line ?? "none");
  let n = 0;
  for await (const _ of stdin.lines()) n++;
  console.log(`lines: ${n}`);
  const text = await stdin.text();
  console.log(`text: [${text}]`);
  const bytes = await stdin.bytes();
  console.log(`bytes: ${bytes.length}`);
}

// case: stdin_no_trailing_newline
// stdin: "a\nlast"
// expect: [a]
// expect: [last]
// expect: end
async function main() {
  while (true) {
    const line = await readLine();
    if (line === null) break;
    console.log(`[${line}]`);
  }
  console.log("end");
}

// case: stdin_crlf
// stdin: "dos\r\nline\r\n\r\nbare\r"
// expect: [dos]
// expect: [line]
// expect: []
// expect: [bare]
async function main() {
  for await (const line of stdin.lines()) console.log(`[${line}]`);
}

// case: stdin_blank_lines
// stdin: "\n\nx\n"
// expect: 3 lines, the last [x]
async function main() {
  let all: string[] = [];
  for await (const line of stdin.lines()) all.push(line);
  console.log(`${all.length} lines, the last [${all[2]}]`);
}

// case: stdin_mixed
// stdin: "head\nmiddle\nnext\ntail one\ntail two"
// expect: head
// expect: middle
// expect: next
// expect: [tail one\ntail two]
async function main() {
  const head = await readLine();
  console.log(head ?? "none");
  for await (const line of stdin.lines()) {
    console.log(line);
    if (line === "middle") break;
  }
  const next = await readLine();
  console.log(next ?? "none");
  const rest = await stdin.text();
  console.log(`[${rest.replaceAll("\n", "\\n")}]`);
}

// case: stdin_utf8
// stdin: "héllo wörld\n日本語\n👍🏽\n"
// expect: héllo wörld 11
// expect: 日本語 3
// expect: 👍🏽 4
async function main() {
  for await (const line of stdin.lines()) console.log(`${line} ${line.length}`);
}

// case: stdin_bytes
// stdin: "ab\né"
// expect: 97 98 10 195 169
async function main() {
  const bytes = await stdin.bytes();
  console.log(bytes.map((b) => String(b)).join(" "));
}

// case: stdin_import
// stdin: "x\ny\n"
// expect: x+y
import { text } from "stdin";
async function main() {
  const all = await text();
  console.log(all.trim().split("\n").join("+"));
}

