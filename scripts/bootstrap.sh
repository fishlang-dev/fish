#!/bin/sh
# Builds fishc from src on a machine with no fishc: the release stage0.toml pins is downloaded as
# this machine's tarball and checked against [tarballs], and its fishc runs scripts/build.fsh.
# Arguments go to scripts/build.fsh. With a fishc already, run that instead:
#   fishc run scripts/build.fsh -- [-o <fishc>]
# With --stage0 nothing is built: the released stage 0 is downloaded and checked, and the last line
# printed is its path, for a caller that only runs scripts with it.
set -e
root=$(cd "$(dirname "$0")/.." && pwd)
toml="$root/stage0.toml"
commit=$(sed -n 's/^commit = "\(.*\)"$/\1/p' "$toml")
release=$(sed -n 's/^release = "\(.*\)"$/\1/p' "$toml")
releases=$(sed -n 's/^releases = "\(.*\)"$/\1/p' "$toml")
arch=$(uname -m)
case "$arch" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; esac
target="$arch-$(uname -s | tr '[:upper:]' '[:lower:]')"
sum=$(sed -n "/^\[tarballs\]/,/^\[/s/^\"$target\" = \"\(.*\)\"$/\1/p" "$toml")

if [ -n "$release" ] && [ -n "$sum" ]; then
  cache="${FISH_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/fish}/stage0/$commit"
  if [ ! -x "$cache/bin/fishc" ]; then
    name="fishc-${release#v}-$target.tar.gz"
    url="${releases:-https://github.com/fishlang-dev/fish/releases/download}/$release/$name"
    mkdir -p "$cache"
    echo "downloading stage 0, $url"
    curl -fsSL -o "$cache/$name" "$url"
    got=$(shasum -a 256 "$cache/$name" | cut -d' ' -f1)
    if [ "$got" != "$sum" ]; then
      echo "bootstrap: $name has sha256 $got, and stage0.toml pins $sum" >&2
      rm -f "$cache/$name"
      exit 1
    fi
    tar -xzf "$cache/$name" -C "$cache" --strip-components=1
    rm -f "$cache/$name"
  fi
  case " $* " in *" --stage0 "*) echo "$cache/bin/fishc"; exit 0 ;; esac
  echo "running scripts/build.fsh with stage 0, $release"
  exec "$cache/bin/fishc" run "$root/scripts/build.fsh" -- "$@"
fi
echo "bootstrap: stage0.toml has no stage 0 for $target, since no release was packed on such a machine; its first one is cross-compiled on a machine that has one, as 'A new target' at the top of scripts/build.fsh says" >&2
exit 1
