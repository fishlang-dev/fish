// mode: parse
function f(a: i64 = 1, b = a + 1, ...rest: i64[]) {
  let empty = []
  let list = [1, 2, 3,]
  let holes = [, a, , b, ,]
  let spread = [...xs, 1, ...ys]
  let call = g(...args, last)
  let obj = {
    a: 1,
    "quoted": 2,
    42: 3,
    [computed]: 4,
    shorthand,
    ...other,
    method(x: i64): i64 { return x },
    generic<T>(x: T) {},
    *generator() {},
    async load() {},
    async *stream() {},
    get size() { return 1 },
    set size(value) {},
    get: 5,
    set: 6,
    async: 7,
    get() {},
    async() {},
    new: 8,
    default: 9,
  }
  let fn = function () {}
  let named = function named<T>(x: T): T { return x }
  let gen = function* () {}
  let asyncFn = async function () {}
  let braces = `${call({ key: { deeper: 1 } })} after`
}
