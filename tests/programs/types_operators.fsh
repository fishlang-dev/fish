// mode: parse
type Union = A | B | null | undefined
type Lines =
  | A
  | B
type Both = A & B | C & D
type Grouped = (A | B)[]
type Literals = 'a' | "b" | -1 | 0 | 42 | true | false
type Keys = keyof T
type Frozen = readonly string[]
type Id = unique symbol
type Lookup = Person["name"]
type Element = T[number][]
type Query = typeof config.server<i64>

function f(a: A | B, b: keyof T): i64 & Brand {
  let x: (A & B)[] = 1
}
