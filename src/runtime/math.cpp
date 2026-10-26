// The runtime's `Math` functions on f64, the same on every platform. Programs call these
// instead of the platform's libm, whose results differ in the last bit between glibc, macOS
// and others, so a Fish program prints the same numbers wherever it runs.
//
// Every one is correctly rounded: the double nearest the exact result. Sixteen come from LLVM
// libc (vendor/llvm-libc), which V8 also uses, and the six hyperbolic ones, which LLVM libc
// doesn't have for doubles, from CORE-MATH (vendor/core-math).
//
// Built as C++ without exceptions or RTTI and linked as plain C: nothing here needs the C++
// runtime.

#include "shared/math/acos.h"
#include "shared/math/asin.h"
#include "shared/math/atan.h"
#include "shared/math/atan2.h"
#include "shared/math/cbrt.h"
#include "shared/math/cos.h"
#include "shared/math/exp.h"
#include "shared/math/expm1.h"
#include "shared/math/hypot.h"
#include "shared/math/log.h"
#include "shared/math/log10.h"
#include "shared/math/log1p.h"
#include "shared/math/log2.h"
#include "shared/math/pow.h"
#include "shared/math/sin.h"
#include "shared/math/tan.h"

namespace libm = LIBC_NAMESPACE::shared;

namespace {

const double NaN = __builtin_nan("");
const double INF = __builtin_inf();

}  // namespace

extern "C" {

double fsh_math_acos(double x) { return libm::acos(x); }
double fsh_math_asin(double x) { return libm::asin(x); }
double fsh_math_atan(double x) { return libm::atan(x); }
double fsh_math_atan2(double y, double x) { return libm::atan2(y, x); }
double fsh_math_cbrt(double x) { return libm::cbrt(x); }
double fsh_math_cos(double x) { return libm::cos(x); }
double fsh_math_exp(double x) { return libm::exp(x); }
double fsh_math_expm1(double x) { return libm::expm1(x); }
double fsh_math_hypot(double x, double y) { return libm::hypot(x, y); }
double fsh_math_log(double x) { return libm::log(x); }
double fsh_math_log10(double x) { return libm::log10(x); }
double fsh_math_log1p(double x) { return libm::log1p(x); }
double fsh_math_log2(double x) { return libm::log2(x); }
double fsh_math_sin(double x) { return libm::sin(x); }
double fsh_math_tan(double x) { return libm::tan(x); }

// `Math.pow` and `**`: C's pow, except where JavaScript differs. A NaN exponent gives NaN
// even for a base of 1, and a base of 1 or -1 to an infinite power gives NaN, not 1.
double fsh_math_pow(double x, double y) {
  if (y != y) return NaN;
  if ((y == INF || y == -INF) && (x == 1 || x == -1)) return NaN;
  return libm::pow(x, y);
}

// CORE-MATH's correctly rounded hyperbolic functions (vendor/core-math), built as C.
double cr_acosh(double);
double cr_asinh(double);
double cr_atanh(double);
double cr_cosh(double);
double cr_sinh(double);
double cr_tanh(double);

double fsh_math_acosh(double x) { return cr_acosh(x); }
double fsh_math_asinh(double x) { return cr_asinh(x); }
double fsh_math_atanh(double x) { return cr_atanh(x); }
double fsh_math_cosh(double x) { return cr_cosh(x); }
double fsh_math_sinh(double x) { return cr_sinh(x); }
double fsh_math_tanh(double x) { return cr_tanh(x); }

}  // extern "C"
