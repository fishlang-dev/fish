// mode: parse
interface Empty {}
interface Point { x: i64; y: i64 }
interface Shape<T extends Unit = Pixels> extends Drawable<T>, Geometry.Sized, Serializable {
  readonly id: string
  name?: string,
  area(): T;
  scale?<U>(factor: U): Shape<U>
  (input: string): boolean
  new (x: i64): Point
  [key: string]: unknown
  readonly [index: number]: string
  [Symbol.iterator](): Iterator<T>
  get size(): i64
  set size(value: i64)
  "quoted-key": i64
  42: boolean
  is(x: unknown): x is Shape<T>
}

function main() {
  interface Local<T> { value: T }
  type Uses = Local<i64>
}
