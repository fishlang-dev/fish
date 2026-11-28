#!/bin/sh
# Prints one stage0.toml from several that pin the same release, each naming one target's digest
# and tarball, as scripts/promote.fsh writes on each target's runner: the first one's lines, with
# every file's targets under [digests] and [tarballs].
#   sh scripts/pins.sh <stage0.toml>...
set -e
[ $# -gt 0 ] || { echo "usage: sh scripts/pins.sh <stage0.toml>..." >&2; exit 1; }
commit=$(sed -n 's/^commit = //p' "$1")
for f in "$@"; do
  if [ "$(sed -n 's/^commit = //p' "$f")" != "$commit" ]; then
    echo "pins: $f pins another commit than $1" >&2
    exit 1
  fi
done
sed '/^\[digests\]$/,$d' "$1"
echo "[digests]"
for f in "$@"; do sed -n '/^\[digests\]$/,/^\[tarballs\]$/{/^"/p;}' "$f"; done
echo
echo "[tarballs]"
for f in "$@"; do sed -n '/^\[tarballs\]$/,${/^"/p;}' "$f"; done
