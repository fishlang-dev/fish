// mode: parse
type Point = { x: i64; y: i64 }
type Commas = { x: i64, y: i64, }
type Lines = {
  readonly id: string
  name?: string
  greet(other: Person): string
  find?<T>(key: K): T
  (input: string): boolean
  new (x: i64): Point
  [key: string]: unknown
  readonly [index: number]: string
  [Symbol.iterator](): Iterator<T>
  get size(): i64
  set size(value: i64)
  "quoted-key": i64
  42: boolean
  new: T; default: U; get: V; set: W; readonly: X
  get(): T
}
type Pair = [i64, string]
type Named = [first: i64, second?: string, ...rest: boolean[]]
type Optional = [A?, ...B[]]
type Nested = { inner: { deeper: [A, { b: B }] } }[]
