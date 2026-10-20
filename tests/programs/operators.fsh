// mode: parse
function f() {
  let a = x ?? y ?? z
  let b = x | y ^ z & w
  let c = x << 2 >> 1 >>> 0
  let d = 2 ** 3 ** 2
  let e = key in obj && obj instanceof Map
  let g = x == y || x != y
  let h = typeof x + void 0 + ~x + +x
  let i = delete obj.prop
  let j = await promise
  let k = ++x + --y + x++ - y--
  let l = (-x) ** 2
  let m = a > b && b >= c && c >> 1 > 0
}
