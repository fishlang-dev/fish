#!/bin/sh
# Installs fishc from a GitHub release:
#   curl -fsSL https://raw.githubusercontent.com/fishlang-dev/fish/main/install.sh | sh
# Downloads the release for this machine, checks its sha256, unpacks it under ~/.fishc, links
# fishc into a directory on PATH (or ~/.local/bin, added to the shell's startup file), and
# builds a hello world to check clang and warm the runtime cache. Settings, all optional:
#   FISHC_VERSION   a release such as 0.1.0, or the latest
#   FISHC_HOME      where releases are unpacked, ~/.fishc
#   FISHC_BIN_DIR   where fishc is linked, a writable directory on PATH or ~/.local/bin
#   FISHC_NO_MODIFY_PATH=1  leave the shell's startup file alone
set -eu

repo="https://github.com/fishlang-dev/fish"
home="${FISHC_HOME:-$HOME/.fishc}"
# A piped script can't change the PATH of the shell that ran it, so fishc is linked into a writable
# directory already on PATH when there is one, and works at once; ~/.local/bin, added to the
# startup file, is the fallback and needs a new terminal.
bin="${FISHC_BIN_DIR:-}"
if [ -z "$bin" ]; then
  for dir in "$HOME/.local/bin" "$HOME/bin" /opt/homebrew/bin /usr/local/bin; do
    case ":$PATH:" in *":$dir:"*) [ -d "$dir" ] && [ -w "$dir" ] && { bin=$dir; break; } ;; esac
  done
  bin="${bin:-$HOME/.local/bin}"
fi

say() { printf '%s\n' "$*"; }
fail() { printf 'install: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null || fail "curl is needed to download fishc"
command -v tar >/dev/null || fail "tar is needed to unpack fishc"

arch=$(uname -m)
case "$arch" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "fishc has no release for $arch processors" ;;
esac
os=$(uname -s)
case "$os" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "fishc runs on macOS and Linux, not $os" ;;
esac
target="$arch-$os"

if [ -n "${FISHC_VERSION:-}" ]; then
  tag="v${FISHC_VERSION#v}"
else
  # The latest release's page is a redirect to its tag, so no API call or JSON parsing is needed.
  latest=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "$repo/releases/latest") || fail "couldn't reach $repo"
  tag=${latest##*/}
  case "$tag" in v*) ;; *) fail "$repo has no release yet" ;; esac
fi
version=${tag#v}
name="fishc-$version-$target"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
say "downloading fishc $version for $target"
curl -fsSL -o "$work/$name.tar.gz" "$repo/releases/download/$tag/$name.tar.gz" ||
  fail "there is no $tag build for $target; the releases are at $repo/releases"
curl -fsSL -o "$work/$name.tar.gz.sha256" "$repo/releases/download/$tag/$name.tar.gz.sha256" ||
  fail "$tag has no sha256 for $name.tar.gz"

want=$(cut -d' ' -f1 "$work/$name.tar.gz.sha256")
if command -v shasum >/dev/null; then got=$(shasum -a 256 "$work/$name.tar.gz" | cut -d' ' -f1)
elif command -v sha256sum >/dev/null; then got=$(sha256sum "$work/$name.tar.gz" | cut -d' ' -f1)
else fail "shasum or sha256sum is needed to check the download"; fi
[ "$got" = "$want" ] || fail "$name.tar.gz has sha256 $got, and the release says $want"

mkdir -p "$home" "$bin"
rm -rf "${home:?}/$name"
tar -xzf "$work/$name.tar.gz" -C "$home"
[ -x "$home/$name/bin/fishc" ] || fail "$name.tar.gz holds no bin/fishc"
# A link, not a copy: fishc finds its runtime sources beside the real binary, in share/fishc.
ln -sf "$home/$name/bin/fishc" "$bin/fishc"
say "installed $home/$name, linked as $bin/fishc"

# Older releases are left in $home, so a version can be switched back to by relinking.
case ":$PATH:" in
  *":$bin:"*) on_path=1 ;;
  *) on_path= ;;
esac
if [ -z "$on_path" ] && [ -z "${FISHC_NO_MODIFY_PATH:-}" ]; then
  case "$(basename "${SHELL:-sh}")" in
    zsh) rc="${ZDOTDIR:-$HOME}/.zshrc"; line="export PATH=\"$bin:\$PATH\"" ;;
    bash) if [ "$os" = darwin ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi; line="export PATH=\"$bin:\$PATH\"" ;;
    fish) rc="$HOME/.config/fish/conf.d/fishc.fish"; line="fish_add_path \"$bin\"" ;;
    *) rc="$HOME/.profile"; line="export PATH=\"$bin:\$PATH\"" ;;
  esac
  mkdir -p "$(dirname "$rc")"
  if ! grep -qsF "$line" "$rc"; then
    printf '\n# fishc\n%s\n' "$line" >>"$rc"
    say "added $bin to PATH in $rc"
  fi
fi

# fishc hands its LLVM IR to clang, so a missing or old clang is the one thing left to fix.
clang_major=$(clang --version 2>/dev/null | sed -n 's/.*clang version \([0-9][0-9]*\).*/\1/p' | head -n 1)
if [ -z "$clang_major" ]; then
  if [ "$os" = darwin ]; then say "warning: fishc needs clang 15 or newer; install it with: xcode-select --install"
  else say "warning: fishc needs clang 15 or newer; install it with your package manager, such as: sudo apt install clang"; fi
elif [ "$clang_major" -lt 15 ]; then
  say "warning: fishc needs clang 15 or newer, and $(command -v clang) is clang $clang_major"
else
  say "checking fishc with a hello world (the first build compiles its runtime once)"
  printf 'function main() {\n  console.log("hello from fish");\n}\n' >"$work/hello.fsh"
  if "$bin/fishc" build "$work/hello.fsh" -o "$work/hello" && [ "$("$work/hello")" = "hello from fish" ]; then
    say "fishc works"
  else
    fail "fishc couldn't build a hello world; report it at $repo/issues"
  fi
fi

say ""
if [ -n "$on_path" ]; then say "run: fishc build hello.fsh -o hello"
else say "open a new terminal, or run: export PATH=\"$bin:\$PATH\""; fi
say "to uninstall: rm -rf \"$home\" \"$bin/fishc\""
