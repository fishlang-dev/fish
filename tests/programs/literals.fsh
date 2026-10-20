// mode: parse
function f() {
  let a = 1.5
  let b = .5
  let c = 1e3
  let d = 2.5E-3
  let e = 1_000.000_1
  let g = 123n
  let h = 0x1fn
  let i = null
  let j = this
  let k = super.method()
  let s = "\x41B\u{1F600}\b\f\v\0\q\'\"\\"
  let t = 'line \
continued'
  let café = 1
}
type N = 1.5 | -2 | 0xff | 1n | -1.5 | -1n | .5
