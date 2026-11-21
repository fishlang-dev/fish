# Fish Lang for VS Code

Support for Fish Lang (`.fsh`) files:

- **Highlighting** from TypeScript's grammar, with Fish's own forms marked: `match`, `|>` and `%`,
  `comptime`, `unsafe`, `macro function`, `throws`, `move`, and the sized number and borrow types.
- **The fishc language server** (`fishc lsp`): errors and warnings as you type, and hints on calls
  that can throw.
- **Tasks**: `fishc build`, `fishc run` and `fishc check` on the open file, from **Run Task**, with
  errors and warnings linked to their source.

`fishc` must be on `PATH`, or named by the `fsh.fishc.path` setting.

## Developing

```sh
npm install
npm run test:grammar   # the grammar's assertion tests
npm run package        # fish-lang-<version>.vsix, installed with "Extensions: Install from VSIX"
```
