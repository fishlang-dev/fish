// mode: parse
function swap([a, b]: [i64, i64], { x, y: { z = 0 } = {}, ...others }: Point = origin) {
  let { name, age: years = 0, ...rest } = person
  const [first, , third = 3, ...tail] = list
  let { a: { b: [c, { d }] } } = deep
  ;[a, b] = [b, a]
  ;({ a, b: target.prop, c = 1 } = source)
  let handler = ({ id }: Event, [key, value] = entry) => id
}
