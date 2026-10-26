// The C glue between Fish and the vendored JS engine, appended to the runtime's source for a
// program that calls the engine, so it reaches the runtime's own helpers.
export const JS_NATIVE = String.raw`
#include "quickjs.h"
`;
