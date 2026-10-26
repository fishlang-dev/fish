# Vendored code

Third-party code compiled into every Fish program's runtime. Each directory keeps its own
licence file, and both licences are compatible with Fish's MIT / Apache-2.0 dual licence.

## llvm-libc

The correctly rounded double-precision `acos`, `asin`, `atan`, `atan2`, `cbrt`, `cos`, `exp`,
`expm1`, `hypot`, `log`, `log10`, `log1p`, `log2`, `pow`, `sin` and `tan` from LLVM's libc,
used header-only through `libc/shared/math`.

- Source: https://github.com/llvm/llvm-project/tree/013c9d52306cde292ed9f3c71e1c43f83152cd29/libc
- Licence: Apache-2.0 WITH LLVM-exception (`llvm-libc/LICENSE.TXT`)
- Contents: the transitive `#include` closure of `libc/shared/math/<function>.h` for those
  functions, at upstream paths, minus the OS and architecture directories Fish doesn't target
  (baremetal, FreeBSD, Fuchsia, GPU, UEFI, Windows, 32-bit ARM, i386, RISC-V, Hexagon).
- Local change: `libc/src/__support/math/atan.h`. The tiny-argument shortcut was taken for
  |x| < 2^-26, but it is only correctly rounded while |x|^3/3 < ulp(x)/2, which fails near the
  top of [2^-27, 2^-26). For example, `atan(-0x1.f25ad7d5bc1ebp-27)` rounded the wrong way. The
  shortcut now applies below 2^-27, and that binade takes the general path. This should go
  upstream.

## core-math

The correctly rounded double-precision `acosh`, `asinh`, `atanh`, `cosh`, `sinh` and `tanh`
from the CORE-MATH project. LLVM libc has no double versions of these.

- Source: https://gitlab.inria.fr/core-math/core-math/-/tree/0ce0cbc15935e24c656280e5a46c34e89f301b7a/src/binary64
- Licence: MIT (`core-math/LICENSE`; each file also carries its own notice)
- Contents: `src/binary64/<function>/<function>.c`, unmodified.

## Updating

Fetch the same paths at a newer commit, re-apply the local change if upstream hasn't fixed
it, and update the commits above. The Math runtime's cache key hashes the vendored sources,
so programs rebuild it on their next compile. Then check the results against a
high-precision reference: `tests/programs/math.fsh` covers known cases, but not a sweep.
