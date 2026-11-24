# Changelog

Each release's changes, newest first, from its conventional commits.

## 0.1.2 - 2026-11-24

### Added

- Tracing, with a span per request from serve and spans in user code, exported as OTLP JSON (#181)
- A std sqlite module over the system's SQLite, linked only when used (#179)
- Using and await using declarations, disposing a value where its scope ends (#178)
- Task groups, whose tasks can't outlive the await that runs them (#177)
- Router handlers that say their types, and fishc openapi (#176)
- Fishc explain-borrows annotates a file with its moves and loans (#173)

### Fixed

- A narrowed field held in a block is lent as the block, not as the place holding its pointer (#187)
- The instance `shed` empties is not named like a tree node (#186)

### Faster

- An instance made with placeholder types is checked only when a caller needs what its body tells (#185)
- Codegen holds the module's text once (#184)
- A plain build's instance tables keep a value per node id, not a site or a copy of the node (#183)
- A body's tree is written once, and an instance that lowers more is compiled from its own copy (#180)
- A release build over 64 MiB of IR is compiled a file at a time (#175)
- A plain build empties the tables of instances it never compiles as each one's check ends (#174)

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
