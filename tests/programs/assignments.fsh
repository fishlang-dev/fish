// mode: parse
function f() {
  a = b = c
  a += 1; a -= 1; a *= 2; a /= 2; a %= 2; a **= 2
  a <<= 1; a >>= 1; a >>>= 1; a &= 1; a |= 1; a ^= 1
  a &&= b; a ||= b; a ??= b
  obj.prop = value
  list[0] = value
  let pick = cond ? yes : no
  let nested = a ? b ? c : d : e
  let pair = (first, second)
  let typed = value as unknown as string
  let frozen = { a: 1 } as const
  let checked = config satisfies Config
  let old = <string>value
  let yielded = yield value
  yield
  yield* other()
  for1(), for2()
}
