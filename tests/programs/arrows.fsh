// mode: parse
function f() {
  let id = x => x
  let add = (a: i64, b: i64): i64 => a + b
  let none = () => {}
  let obj = () => ({ a: 1 })
  let generic = <T,>(x: T): T => x
  let bounded = <T extends object>(x: T) => x
  let defaults = (x = 1, ...rest: i64[]) => rest
  let asyncArrow = async (url: string) => {
    let response = await fetch(url)
    if (response.ok) {
      return response.json()
    }
    return null
  }
  let asyncSingle = async x => await x
  let curried = (a: i64) => (b: i64) => (c: i64) => a + b + c
  let guard = (x: unknown): x is string => typeof x === "string"
  let callbacks = list.filter(x => x > 0).map((x, i) => x * i)
  let notArrow = (a, b)
  let callAsync = async(1, 2)
}
