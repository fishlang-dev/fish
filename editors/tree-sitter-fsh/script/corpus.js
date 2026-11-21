// Parses every .fsh file in the compiler's tree and fails on any ERROR or MISSING node.
// A test file's cases are parsed one at a time, and a case expecting a compile error is
// left out, since some of those are syntax errors on purpose.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fsh-corpus-'));

function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    // A program spanning a directory states its expected error in main.fsh, and the error
    // may be in any of its files.
    const main = path.join(full, 'main.fsh');
    if (entry.isDirectory() && fs.existsSync(main) && /^\/\/ error:/m.test(fs.readFileSync(main, 'utf8'))) continue;
    if (entry.isDirectory()) yield* files(full);
    else if (entry.name.endsWith('.fsh')) yield full;
  }
}

// tree-sitter's lexer reads a NUL byte as the end of input, so a file holding one is left out.
function cases(text) {
  if (text.includes('\0')) return [];
  const parts = text.split(/^(?=\/\/ case: )/m);
  return parts.filter((part) => !/^\/\/ error:/m.test(part));
}

const paths = [];
for (const dir of ['src', 'scripts', 'tests']) {
  for (const file of files(path.join(root, dir))) {
    const rel = path.relative(root, file);
    cases(fs.readFileSync(file, 'utf8')).forEach((text, i) => {
      const target = path.join(out, `${rel.replaceAll(path.sep, '__')}.${i}.fsh`);
      fs.writeFileSync(target, text);
      paths.push(target);
    });
  }
}
const list = path.join(out, 'paths.txt');
fs.writeFileSync(list, paths.join('\n'));

let failed = false;
try {
  execFileSync('tree-sitter', ['parse', '--quiet', '--stat', '--paths', list], { stdio: 'inherit' });
} catch {
  failed = true;
}
if (!process.env.KEEP) fs.rmSync(out, { recursive: true });
process.exit(failed ? 1 : 0);
