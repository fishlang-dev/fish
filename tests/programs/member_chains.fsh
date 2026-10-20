// mode: parse
function f() {
  let a = obj.prop.deeper
  let b = obj["key"][0]
  let c = obj?.prop?.[key]?.(arg)
  let d = maybe!.value!
  let e = new Date()
  let g = new Map<string, i64>()
  let h = new Thing
  let i = new outer.Inner(1, 2).method()
  let j = import.meta.url
  let k = import("./module.ts")
  let l = parse<Config>(text)
  let m = identity<string>
  let n = list.map<i64>(double)
  let o = a?.b.c.d()
  let p = x.default + y.new
  let q = function () { return new.target }
}
