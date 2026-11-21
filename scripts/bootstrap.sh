#!/bin/sh
# Builds fishc from src on a machine with no fishc: the commit stage0.toml pins is unpacked, and its
# own compiler, run by Bun, runs scripts/build.fsh, which builds stage 0 from that commit and then
# fishc with it. Arguments go to scripts/build.fsh. With a fishc already, run that instead:
#   fishc run scripts/build.fsh -- [-o <fishc>]
set -e
root=$(cd "$(dirname "$0")/.." && pwd)
commit=$(sed -n 's/^commit = "\(.*\)"$/\1/p' "$root/stage0.toml")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
echo "unpacking the compiler at $commit, which Bun runs to start the build"
git -C "$root" archive "$commit" | tar -x -C "$work"
echo "running scripts/build.fsh with Bun; compiling it takes a minute or two before it prints"
bun "$work/src/main.ts" run "$root/scripts/build.fsh" -- "$@"
