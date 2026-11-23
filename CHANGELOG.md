# Changelog

Each release's changes, newest first, from its conventional commits.

## 0.1.1 - 2026-11-23

### Added

- Read what fishc holds live as a stage ends (#164)
- Install fishc from a release with one curl command
- FISH_MEM=1 prints what fishc holds as each stage ends
- Stage 0 as a released fishc, with scripts/promote.fsh

### Fixed

- Link fishc into a directory already on PATH when installing
- FISH_MEM reads memory through POSIX rather than a new runtime function
- A release's fishc is built at the fixed path its commit unpacks to

### Faster

- A plain build drops the checked program before clang runs (#171)
- An instance is found by a number for each binding's type key, not by the keys written out (#170)
- An instance takes its body's id without cloning the body (#169)
- A field naming an object or union of objects of its own group of aliases is stored behind a pointer (#168)
- Codegen empties what the check recorded of each expression before it assembles the module (#167)
- The checked program and its IR are taken from a call, not unwrapped from a local (#166)
- An importer holds a handle to the module it names, not a copy of it (#165)
- Calls and coercions keep each expression's site, not a copy of it
- A jump's target is kept by id and span, and FISH_MEM counts the checker's tables
- An instance's types table keeps each expression's site, not a copy of it

## 0.1.0 - 2026-11-22

The first release.
