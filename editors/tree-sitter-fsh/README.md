# tree-sitter-fsh

A [tree-sitter](https://tree-sitter.github.io) grammar for Fish Lang (`.fsh`). It is
tree-sitter-typescript's grammar with Fish's own forms added: `match` and its patterns, `|>` and
`%`, `comptime`, `unsafe`, `macro function`, `throws`, `move` closures, `using` and `await using`
declarations, enums whose variants carry values, and decorators on functions, types and enums.

The language is named `fsh` because the fish shell already owns `fish` and `tree-sitter-fish`.

## Developing

```sh
npm install
npm run generate   # src/parser.c from grammar.js
npm test           # the cases in test/corpus
npm run corpus     # every .fsh file in src, scripts and tests parses with no ERROR or MISSING node
```

`src/` is generated and committed, so editors can build the parser without the CLI.

## Queries

`queries/highlights.scm` and `queries/tags.scm` hold Fish's additions only. Use them after
TypeScript's and JavaScript's, as `tree-sitter.json` lists them.

**Neovim** (nvim-treesitter): register the parser, then put a `highlights.scm` beginning with
`; inherits: typescript` and this file's patterns under `queries/fsh/`.

```lua
vim.filetype.add({ extension = { fsh = "fsh" } })
require("nvim-treesitter.parsers").get_parser_configs().fsh = {
  install_info = { url = "https://github.com/fishlang-dev/fish", location = "editors/tree-sitter-fsh", files = { "src/parser.c", "src/scanner.c" } },
}
```

**Helix**: add a `[[language]]` named `fsh` with `file-types = ["fsh"]` and a `[[grammar]]` whose
source is this directory, then `; inherits: typescript` at the top of
`runtime/queries/fsh/highlights.scm`.
